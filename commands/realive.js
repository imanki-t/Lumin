/**
 * @fileoverview Command to periodically send AI-generated revival messages
 * to inactive server channels.
 */

import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { state, saveStateToFile, genAI } from '../managers/BotManager.js';
import * as db from '../database/index.js';
import { memorySystem } from '../memory/MemorySystem.js';
import { MODELS, DEFAULT_MODEL } from '../modules/config.js';
import { Logger } from '../core/Logger.js';

const logger = Logger.get('Realive');
const REVIVAL_MODEL = DEFAULT_MODEL;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** @type {!Object} */
export const reviveCommand = {
  name: 'schedule',
  description: 'Auto-send revival messages to quiet channels.',
  options: [
    {
      name: 'action',
      description: 'What do you want to do?',
      type: 3,
      required: true,
      choices: [
        { name: 'Enable', value: 'enable' },
        { name: 'Disable', value: 'disable' },
        { name: 'Interval', value: 'interval' },
        { name: 'Status', value: 'status' }
      ]
    },
    {
      name: 'hours',
      description: 'Interval in hours (used with action: interval)',
      type: 4,
      required: false,
      min_value: 1,
      max_value: 168
    }
  ]
};

/**
 * Handles configuration and actions for the chat revival command.
 * @param {!import('discord.js').CommandInteraction} interaction
 * @return {!Promise<void>}
 */
export async function handleReviveCommand(interaction) {
  const guild = interaction.guild;

  if (!guild) {
    return interaction.reply({
      content: '❌ This command can only be used in servers.',
      ephemeral: true
    });
  }

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({
      content: '🚫 You need **Manage Server** permission to configure chat revival.',
      ephemeral: true
    });
  }

  const action = interaction.options.getString('action');
  const hours = interaction.options.getInteger('hours');
  const guildId = guild.id;

  if (!state.realive) state.realive = {};
  if (!state.realive[guildId]) {
    state.realive[guildId] = {
      enabled: false,
      intervalHours: 12,
      lastRun: 0,
      lastChannelId: null
    };
  }

  const guildConfig = state.realive[guildId];

  switch (action) {
    case 'enable': {
      guildConfig.enabled = true;
      if (!guildConfig.lastChannelId) {
        guildConfig.lastChannelId = interaction.channelId;
      }

      await persistConfig(guildId, guildConfig);
      return interaction.reply({
        content:
          `✅ **Chat Revival Enabled!**\n\n` +
          `I will attempt to revive dead chats every **${guildConfig.intervalHours} hours** ` +
          `in the last active channel (<#${guildConfig.lastChannelId}>).`
      });
    }

    case 'disable': {
      guildConfig.enabled = false;
      await persistConfig(guildId, guildConfig);
      return interaction.reply({ content: '🛑 **Chat Revival Disabled.**' });
    }

    case 'interval': {
      if (!hours) {
        return interaction.reply({
          content: '⚠️ Please specify the number of hours using the `hours` option.',
          ephemeral: true
        });
      }
      guildConfig.intervalHours = hours;
      await persistConfig(guildId, guildConfig);
      return interaction.reply({
        content: `⏱️ **Interval Updated!**\n\nI will now check for chat revival every **${hours} hours**.`
      });
    }

    case 'status': {
      const channelText = guildConfig.lastChannelId
        ? `<#${guildConfig.lastChannelId}>`
        : 'None (Talk to me to set one!)';

      const embed = new EmbedBuilder()
        .setColor(0x00FFFF)
        .setTitle('✨ Channel Revival Status')
        .addFields(
          { name: 'Status', value: guildConfig.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Interval', value: `${guildConfig.intervalHours} hours`, inline: true },
          { name: 'Target Channel', value: channelText, inline: false },
          {
            name: 'Last Run',
            value: guildConfig.lastRun ? new Date(guildConfig.lastRun).toLocaleString() : 'Never',
            inline: false
          }
        );

      return interaction.reply({ embeds: [embed] });
    }

    default:
      return interaction.reply({
        content: '❌ Unknown action.',
        ephemeral: true
      });
  }
}

/**
 * Starts the automated loop to check background revival status.
 * @param {!import('discord.js').Client} client
 */
export function startReviveLoop(client) {
  setInterval(() => checkAndRevive(client), CHECK_INTERVAL_MS);
  logger.info('Realive background task started');
}

/**
 * Iterates through servers to determine which channels require interaction.
 * @param {!import('discord.js').Client} client
 * @return {!Promise<void>}
 */
async function checkAndRevive(client) {
  if (!state.realive) return;

  const now = Date.now();

  for (const [guildId, guildConfig] of Object.entries(state.realive ?? {})) {
    if (!guildConfig.enabled || !guildConfig.lastChannelId) continue;

    const intervalMs = guildConfig.intervalHours * 60 * 60 * 1000;
    const timeSinceLastRun = now - (guildConfig.lastRun || 0);
    if (timeSinceLastRun < intervalMs) continue;

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      const channel = guild.channels.cache.get(guildConfig.lastChannelId);
      if (!channel) continue;

      const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      const lastMsg = messages?.first();

      const shouldRevive = !lastMsg || (now - lastMsg.createdTimestamp) >= intervalMs;

      guildConfig.lastRun = now;
      await persistConfig(guildId, guildConfig);

      if (shouldRevive) {
        await sendRevivalMessage(channel, guildId);
      }
    } catch (error) {
      logger.error(`Realive task failed for guild ${guildId}`, error);
    }
  }
}

/**
 * Constructs and transmits an AI payload to the targeted guild channel.
 * @param {!import('discord.js').TextChannel} channel
 * @param {string} guildId
 * @return {!Promise<void>}
 */
async function sendRevivalMessage(channel, guildId) {
  try {
    const history = await memorySystem.getOptimizedHistory(
      guildId,
      'generate conversation revival message',
      REVIVAL_MODEL
    );

    let contextPrompt = 'Generate a casual, natural message to revive this dead chat. ';
    contextPrompt += history?.length > 0
      ? 'Reference recent conversation topics naturally. '
      : "Since there's no recent history, create a general engaging question. ";
    contextPrompt +=
      "Keep it short, casual, and friendly — like you're genuinely wondering where everyone went. " +
      'Examples: "duhh, where are all of you?", "sooo... did everyone disappear? 👀", "it\'s quiet here... too quiet 🤔"';

    const serverSettings = state.serverSettings?.[guildId] ?? {};
    const customPersonality = serverSettings.customPersonality || state.customInstructions?.[guildId];

    let systemInstruction = botConfig.coreSystemRules;
    systemInstruction += customPersonality
      ? `\n\nADDITIONAL PERSONALITY:\n${customPersonality}`
      : `\n\n${botConfig.defaultPersonality}`;
    systemInstruction +=
      "\n\nYou're sending a message to revive a quiet Discord server. Be natural and casual — " +
      "you're not announcing anything, just casually checking in or commenting on topics people were discussing. " +
      "Reference recent conversations if available. Don't use quotes or formal greetings.";

    const request = {
      model: REVIVAL_MODEL,
      contents: [
        ...(history ?? []),
        { role: 'user', parts: [{ text: contextPrompt }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.95,
        topP: 0.95
      }
    };

    const result = await genAI.models.generateContent(request);
    let revivalMsg = result.text ?? '';

    revivalMsg = revivalMsg
      .replace(/^["']|["']$/g, '')
      .replace(/^\*\*|\*\*$/g, '')
      .trim();

    await channel.send(revivalMsg || pickFallback());
  } catch (error) {
    logger.error('Failed to generate revival message', error);
    await channel.send(pickFallback());
  }
}

/**
 * Provides a string list array fallback backup structure.
 * @return {string}
 */
function pickFallback() {
  const fallbacks = [
    // ── originals ──────────────────────────────────────────────────────────
    'duhh, where are all of you? 👀',
    'sooo... did everyone disappear?',
    "it's quiet here... too quiet 🤔",
    'hellooo? anyone there? 🙃',
    '*checks if server is still alive*',
    "y'all ghosted the chat or what? 😭",

    // ── flat / deadpan check-ins ────────────────────────────────────────────
    'hello?? is this thing on',
    'oi. hi.',
    'hello yes it is me',
    'HELLO',
    'hi i exist and so do you (probably) so',
    'hello from the other side of this dead chat',
    'this is me knocking on the chat door',
    'hello to whoever reads this at some point',
    'hey. hi. hello. come back.',
    'i\'m here. barely. but i\'m here.',
    'oi. activity. now.',
    'oi i\'m talking to you',

    // ── mild exasperation ───────────────────────────────────────────────────
    'bro the chat has been dead for hours fr',
    'ngl i feel like i\'m talking to a wall rn',
    'ok who killed the chat and why',
    'everyone\'s really just gonna ghost like that huh',
    'wait did everyone leave and nobody told me',
    'the chat died and i took it personally',
    'i refuse to be the last one standing in this server',
    'bruh it\'s been so long',
    'y\'all really just gave up huh',
    'bruh where\'d everyone go',
    'y\'all disappeared and took the vibe with you',
    'ngl expected more chaos here today',
    'ngl this level of quiet is actually impressive',
    'every day i wake up and check this server and every day it disappoints me lmao',
    'the chat woke up and chose silence. again.',
    'ngl at this point i\'m just yelling into a canyon',
    'this level of silence is actually a skill',

    // ── concern / wellness checks ───────────────────────────────────────────
    '…y\'all good out there or',
    'sending this into the void: how\'s everyone doing',
    'genuinely asking — did something happen while i wasn\'t looking',
    'revive check. is anyone breathing.',
    'i\'m giving this server a wellness check',
    'genuinely wondering if the wifi cut out for everyone at once',
    'the chat has no pulse and i\'m concerned',
    'wait is something going on or is this just regular dead',
    'any exciting drama i missed? genuinely asking.',
    'wait so we\'re all just. sitting here. in silence.',

    // ── self-aware observations ─────────────────────────────────────────────
    'the silence is literally so loud rn',
    'this is so quiet it\'s actually unsettling',
    'the quiet is making me think things',
    'at this point the server is just a museum',
    'the vibes here are very \'abandoned mall at 3am\'',
    'the tumbleweed is literally rolling through here',
    'the chat is flatlining and i\'m trying not to panic',
    'the server has been on do not disturb mode for too long now',
    'at this point this server is just decorative',
    'this chat is giving \'last one at the party\' energy',
    'why does the server feel like a graveyard lately',
    'ngl this quiet is starting to feel intentional',
    'lowkey been waiting for someone else to start talking and it hasn\'t happened',
    'lowkey feeling like the last person on earth rn',
    'lowkey miss when this was alive',
    'i\'m starting to suspect everyone is living their lives and not telling me',
    'bro this quiet is making me spiral',

    // ── soft / understated care ─────────────────────────────────────────────
    'lowkey this quiet is starting to feel intentional',
    'i\'m not mad at the silence. i\'m just disappointed.',
    'come back. i won\'t be weird about it.',
    'i\'m not desperate for conversation. i\'m just standing here. with a question.',
    'reviving this chat by sheer force of will',
    'this is fine. totally fine.',
    'ok fine i\'ll start',

    // ── conversation starters ───────────────────────────────────────────────
    'can we talk about literally anything rn',
    'ok new topic: what did everyone eat today',
    'does anyone want to talk about something. anything.',
    'ok so what\'s everyone\'s damage rn',
    'anyone have a hot take they\'ve been holding onto',
    'if anyone\'s lurking just say literally anything',
    'ok i\'m bored. someone be interesting.',
    'come on. give me something.',
    'genuinely what are you all doing rn',
    'anyone wanna debate something random',
    'someone say literally anything i beg',
    'ok we need to fix this. someone go first.',
    'ok but what if we all just... talked',
    'anyone have something they need to say? now\'s a great time.',
    'ok something random: what\'s your go-to comfort food',
    'hot take: we should talk more. starting now.',
    'what\'s everyone being quiet about',
    'hello fellow humans what\'s up',
    'ngl i was expecting more from this server today',
    'ok i\'m just gonna ask: what\'s going on with everyone',

    // ── flat unhinged (brainrot adjacent) ──────────────────────────────────
    'the server said nothing. as usual.',
    'the chat is cooked',
    'this chat has no pulse',
    'hello yes the chat misses you (i\'m the chat)',
    'wake up babes new day',
    'ngl the silence is kinda sus',
    'the chat energy has been 🪦 let\'s fix that',
    'i\'m not saying the chat is dead but. the chat might be dead.',
    'i feel like i should check if the server is still standing',
    'the server said \'not today\' and logged off i guess',
    'alright what happened here',
    'i\'m just gonna pretend i\'m ok with this silence',
    'at this point i\'m talking to myself and that\'s fine i guess',
    'genuinely cannot tell if the server is on silent or everyone just evaporated',
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Handles runtime operations configuration state logging persistence.
 * @param {string} guildId
 * @param {!Object} guildConfig
 * @return {!Promise<void>}
 */
async function persistConfig(guildId, guildConfig) {
  state.realive[guildId] = guildConfig;
  await db.saveRealiveConfig(guildId, guildConfig);
  await saveStateToFile();
}
