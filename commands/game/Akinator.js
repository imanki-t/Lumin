/**
 * @fileoverview Akinator game — AI guesses the character the user is thinking of.
 *
 * Game state is stored on client.akinatorGames (Map) to survive across interactions.
 * Each session TTL is 30 minutes; a periodic cleanup runs every hour.
 *
 * @module commands/game/Akinator
 */

import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';

import { genAI }         from '../../managers/BotManager.js';
import { DEFAULT_MODEL } from '../../modules/config.js';
import { Logger }        from '../../core/Logger.js';
import { setButtonExpiry, handleGameError } from './gameUtils.js';

const logger     = Logger.get('Akinator');
const GAME_MODEL = DEFAULT_MODEL;

/** Max lifetime of a game session in ms. */
const GAME_TTL_MS    = 30 * 60 * 1000;
const CLEANUP_MS     = 60 * 60 * 1000;
const MAX_QUESTIONS  = 20;

const SYSTEM_INSTRUCTION = `You are Akinator. Your goal is to guess the character (real or fictional) the user is thinking of.
Rules:
1. Ask ONE yes/no question at a time.
2. Be strategic. Narrow down categories (Real/Fictional, Gender, Profession, Source Material).
3. After 7-10 questions (or when confident >80%), make a guess.
4. Output ONLY the question OR the guess — nothing else.
5. If making a guess, start exactly with "I guess:" followed by the name.`;

const ANSWER_LABELS = Object.freeze({
  yes:  'Yes',
  no:   'No',
  dk:   "Don't Know",
  prob: 'Probably',
  pn:   'Probably Not'
});

// ============================================================================
// PUBLIC HANDLERS
// ============================================================================

/**
 * Show game mode selection, or skip directly to individual mode in DMs.
 * @param {import('discord.js').Interaction} interaction  Already acknowledged.
 */
export async function showAkinatorModeSelection(interaction) {
  try {
    // In DMs there's no concept of "group" — skip mode selection
    if (!interaction.guild) {
      return await startAkinatorGame(interaction, 'individual');
    }

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🔮 Akinator — Choose Mode')
      .setDescription('How do you want to play?');

    const modeSelect = new StringSelectMenuBuilder()
      .setCustomId('akinator_mode')
      .setPlaceholder('Select game mode')
      .addOptions(
        { label: 'Individual', value: 'individual', description: 'Only you can answer',       emoji: '👤' },
        { label: 'Group',      value: 'group',      description: 'Everyone can participate', emoji: '👥' }
      );

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(modeSelect)]
    });

    const message = await interaction.fetchReply();
    setButtonExpiry(message);

  } catch (error) {
    logger.error('showAkinatorModeSelection failed', error);
    await handleGameError(interaction, 'Failed to show Akinator mode selection.');
  }
}

/**
 * Mode selected — start the game.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function handleAkinatorModeSelect(interaction) {
  try {
    await interaction.update({ components: [] });
    await startAkinatorGame(interaction, interaction.values[0]);
  } catch (error) {
    logger.error('handleAkinatorModeSelect failed', error);
    await handleGameError(interaction, 'Failed to start Akinator.');
  }
}

/**
 * Process a Yes/No/etc. answer and either ask the next question or make a guess.
 *
 * IMPORTANT: user ownership is validated BEFORE calling interaction.update()
 * so individual-mode games can't be hijacked by other users.
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAkinatorAnswer(interaction) {
  try {
    const parts  = interaction.customId.split('_');
    const answer = parts[1];
    const gameId = parts.slice(2).join('_');

    const game = interaction.client.akinatorGames?.get(gameId);

    // Validate session
    if (!game) {
      return interaction.reply({
        content:  '❌ Game session expired or not found. Start a new one with `/game`.',
        flags:    MessageFlags.Ephemeral
      });
    }

    // Validate ownership BEFORE touching the message
    if (game.mode === 'individual' && interaction.user.id !== game.starterId) {
      return interaction.reply({
        content:  '🔒 This is an individual game — only the player who started it can answer.',
        flags:    MessageFlags.Ephemeral
      });
    }

    // Clear buttons from answered question
    await interaction.update({ components: [] });

    game.timestamp = Date.now();
    game.questionCount++;

    const userAns = ANSWER_LABELS[answer] ?? 'Yes';

    let result;
    try {
      result = await game.chat.sendMessage({
        message: `User answered: ${userAns}. If you are over 80% confident or have asked more than 15 questions, make a guess starting with "I guess:". Otherwise ask next question.`
      });
    } catch (apiError) {
      logger.error('Akinator API error during answer', apiError);
      return interaction.followUp({ content: '🧠 Brain freeze! Try again.', flags: MessageFlags.Ephemeral });
    }

    const responseText = result.text?.trim() ?? '';

    if (responseText.toLowerCase().startsWith('i guess:') || game.questionCount >= MAX_QUESTIONS) {
      await sendAkinatorGuess(interaction, gameId, game, responseText);
    } else {
      await sendAkinatorQuestion(interaction, gameId, responseText, game.mode);
    }

  } catch (error) {
    logger.error('handleAkinatorAnswer failed', error);
    await interaction.followUp({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
  }
}

/**
 * Handle "Correct!" / "Wrong" result buttons.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAkinatorResult(interaction) {
  try {
    const parts  = interaction.customId.split('_');
    const result = parts[1];        // 'correct' | 'wrong'
    const gameId = parts.slice(2).join('_');

    await interaction.update({ components: [] });

    // Clean up session
    const game = interaction.client.akinatorGames?.get(gameId);
    if (game) interaction.client.akinatorGames.delete(gameId);

    const isWin = result === 'correct';
    const embed = new EmbedBuilder()
      .setColor(isWin ? 0x00FF00 : 0xFF5555)
      .setTitle(isWin ? '🎉 I Guessed It!' : '😅 You Win!')
      .setDescription(isWin ? 'Akinator never fails! (Well, almost…)' : "I couldn't guess it. You stumped me!");

    const againButton = new ButtonBuilder()
      .setCustomId('akinator_again')
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄');

    await interaction.followUp({
      embeds:     [embed],
      components: [new ActionRowBuilder().addComponents(againButton)]
    });

    const msg = await interaction.fetchReply();
    setButtonExpiry(msg);

  } catch (error) {
    logger.error('handleAkinatorResult failed', error);
  }
}

/**
 * "Play Again" button — start fresh mode selection.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleAkinatorAgain(interaction) {
  try {
    await interaction.update({ components: [] });
    await showAkinatorModeSelection(interaction);
  } catch (error) {
    logger.error('handleAkinatorAgain failed', error);
  }
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Initialise a new Akinator game session and send the first question.
 * @param {import('discord.js').Interaction} interaction
 * @param {'individual'|'group'} mode
 */
async function startAkinatorGame(interaction, mode = 'group') {
  try {
    const chat = genAI.chats.create({
      model:  GAME_MODEL,
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7 }
    });

    if (!interaction.client.akinatorGames) {
      interaction.client.akinatorGames = new Map();
    }

    const gameId = `${interaction.user.id}-${Date.now()}`;

    interaction.client.akinatorGames.set(gameId, {
      chat,
      questionCount: 0,
      mode,
      starterId:     interaction.user.id,
      timestamp:     Date.now()
    });

    // One-time cleanup interval per bot restart
    if (!interaction.client.akinatorCleanupInterval) {
      interaction.client.akinatorCleanupInterval = setInterval(() => {
        const now = Date.now();
        interaction.client.akinatorGames?.forEach((g, key) => {
          if (now - g.timestamp > GAME_TTL_MS) {
            interaction.client.akinatorGames.delete(key);
          }
        });
      }, CLEANUP_MS);
    }

    const result   = await chat.sendMessage({ message: 'Start game. Ask the first broad question.' });
    const question = result.text?.trim() || 'Is your character a real person?';

    await sendAkinatorQuestion(interaction, gameId, question, mode);

  } catch (error) {
    logger.error('startAkinatorGame failed', error);
    await handleGameError(interaction, 'Failed to start Akinator.');
  }
}

/**
 * Send a question embed with the 5 answer buttons.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} gameId
 * @param {string} question
 * @param {'individual'|'group'} mode
 */
async function sendAkinatorQuestion(interaction, gameId, question, mode) {
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🔮 Akinator')
    .setDescription(`**${question}**`)
    .setFooter({ text: mode === 'individual' ? 'Only you can answer' : 'Group Mode — Anyone can answer' });

  const makeBtn = (id, label, style) =>
    new ButtonBuilder().setCustomId(`akinator_${id}_${gameId}`).setLabel(label).setStyle(style);

  const row1 = new ActionRowBuilder().addComponents(
    makeBtn('yes',  'Yes',          ButtonStyle.Success),
    makeBtn('no',   'No',           ButtonStyle.Danger),
    makeBtn('dk',   "Don't Know",   ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    makeBtn('prob', 'Probably',     ButtonStyle.Primary),
    makeBtn('pn',   'Probably Not', ButtonStyle.Primary)
  );

  await interaction.followUp({
    embeds:     [embed],
    components: [row1, row2]
  });

  const message = await interaction.fetchReply();
  setButtonExpiry(message);
}

/**
 * Send the final guess embed with Correct / Wrong buttons.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} gameId
 * @param {object} game
 * @param {string} responseText
 */
async function sendAkinatorGuess(interaction, gameId, game, responseText) {
  const guess = responseText.replace(/^i guess:/i, '').trim();

  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🔮 Final Guess!')
    .setDescription(`I think it is...\n**${guess}**`)
    .setFooter({ text: `Questions asked: ${game.questionCount}` });

  const correctBtn = new ButtonBuilder()
    .setCustomId(`akinator_correct_${gameId}`)
    .setLabel('Correct!')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const wrongBtn = new ButtonBuilder()
    .setCustomId(`akinator_wrong_${gameId}`)
    .setLabel('Wrong')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  await interaction.followUp({
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(correctBtn, wrongBtn)]
  });

  const msg = await interaction.fetchReply();
  setButtonExpiry(msg);
}
