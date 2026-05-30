/**
 * @fileoverview /details command — display bot's server anniversary and conversation stats.
 * @module commands/fun/AnniversaryHandler
 */

import {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ChannelType
} from 'discord.js';

import { state }  from '../../managers/BotManager.js';
import { Logger } from '../../core/Logger.js';

const logger = Logger.get('AnniversaryHandler');

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export const anniversaryCommand = {
  name:        'details',
  description: "View bot's server details and conversation statistics"
};

// ============================================================================
// CONSTANTS
// ============================================================================

const ACCENT_COLOR     = 0xE53935;
const IS_COMPONENTS_V2 = 1 << 15;

const VERIFICATION_LABELS = Object.freeze({
  0: 'None',
  1: 'Low — verified email required',
  2: 'Medium — registered 5+ min',
  3: 'High — member 10+ min',
  4: 'Highest — phone verified'
});

const CONTENT_FILTER_LABELS = Object.freeze({
  0: 'Disabled',
  1: 'Members without roles',
  2: 'All members'
});

const BOOST_TIER_LABELS = Object.freeze({
  0: '○ No Tier',
  1: '🌸 Tier 1',
  2: '💎 Tier 2',
  3: '🏆 Tier 3'
});


const FEATURE_BADGES = Object.freeze({
  COMMUNITY:                      '🏘️ Community',
  PARTNERED:                      '🤝 Partnered',
  VERIFIED:                       '✅ Verified',
  DISCOVERABLE:                   '🔍 Discoverable',
  MONETIZATION_ENABLED:           '💰 Monetization',
  NEWS:                           '📰 News Channels',
  WELCOME_SCREEN_ENABLED:         '👋 Welcome Screen',
  INVITE_SPLASH:                  '🎨 Invite Splash',
  VANITY_URL:                     '🔗 Vanity URL',
  ANIMATED_ICON:                  '🌀 Animated Icon',
  BANNER:                         '🖼️ Banner',
  THREADS_ENABLED:                '🧵 Threads',
  MEMBER_VERIFICATION_GATE_ENABLED: '🛡️ Member Screening'
});

// ============================================================================
// HELPERS
// ============================================================================

/** Discord absolute + relative timestamp string. */
function ts(date) {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:D> (<t:${unix}:R>)`;
}

/** Bold section heading with emoji. */
function heading(emoji, title) {
  return `${emoji}  **${title}**`;
}

/** Add a separator + text section to a container. */
function addSection(container, content) {
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

// ============================================================================
// HANDLER
// ============================================================================

/**
 * Show how long the bot has been in the server and key conversation statistics.
 * @param {import('discord.js').CommandInteraction} interaction
 */
export async function handleAnniversaryCommand(interaction) {
  if (!interaction.guild) {
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Server Only**\nThis command can only be used in servers.')
    );
    return interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 });
  }

  try {
    // ── Fetch owner so we have the username ──────────────────────────────────
    let ownerTag = `<@${interaction.guild.ownerId}>`;
    try {
      const owner = await interaction.client.users.fetch(interaction.guild.ownerId);
      ownerTag = `${owner.username} (<@${owner.id}>)`;
    } catch { /* fallback to mention */ }

    const guild = interaction.guild;

    // ── Bot membership duration ──────────────────────────────────────────────
    const botMember = guild.members.cache.get(interaction.client.user.id);
    const joinDate  = botMember?.joinedAt ?? new Date();
    const now       = Date.now();

    const daysSince     = Math.floor((now - joinDate.getTime()) / 86_400_000);
    const yearsSince    = Math.floor(daysSince / 365);
    const remainingDays = daysSince % 365;
    const monthsSince   = Math.floor(remainingDays / 30);
    const finalDays     = remainingDays % 30;

    const durationParts = [];
    if (yearsSince > 0)  durationParts.push(`${yearsSince} year${yearsSince  !== 1 ? 's' : ''}`);
    if (monthsSince > 0) durationParts.push(`${monthsSince} month${monthsSince !== 1 ? 's' : ''}`);
    if (finalDays > 0 || durationParts.length === 0)
      durationParts.push(`${finalDays} day${finalDays !== 1 ? 's' : ''}`);
    const timeDisplay = durationParts.join(', ');

    // ── Channel counts ───────────────────────────────────────────────────────
    const channels        = guild.channels.cache;
    const textCount       = channels.filter(c => c.type === ChannelType.GuildText).size;
    const voiceCount      = channels.filter(c => c.type === ChannelType.GuildVoice).size;
    const stageCount      = channels.filter(c => c.type === ChannelType.GuildStageVoice).size;
    const forumCount      = channels.filter(c => c.type === ChannelType.GuildForum).size;
    const categoryCount   = channels.filter(c => c.type === ChannelType.GuildCategory).size;
    const announcCount    = channels.filter(c => c.type === ChannelType.GuildAnnouncement).size;
    const totalChannels   = channels.size;

    // ── Member counts (use memberCount for accuracy; cache for bot split) ────
    const totalMembers = guild.memberCount;
    const cachedBots   = guild.members.cache.filter(m => m.user.bot).size;
    const cachedHumans = guild.members.cache.filter(m => !m.user.bot).size;
    const memberNote   = guild.members.cache.size < totalMembers
      ? ` *(${cachedHumans} humans / ${cachedBots} bots cached)*`
      : ` (${cachedHumans} humans / ${cachedBots} bots)`;

    // ── Guild features ───────────────────────────────────────────────────────
    const activeFeatures = (guild.features ?? [])
      .filter(f => FEATURE_BADGES[f])
      .map(f => FEATURE_BADGES[f])
      .join('  ·  ') || 'None';

    // ── Server icon + banner ─────────────────────────────────────────────────
    const iconURL   = guild.iconURL({ size: 256, extension: 'png' });
    const bannerURL = guild.bannerURL({ size: 1024, extension: 'png' });
    const iconLine  = iconURL ? `**🖼️ Icon:** [View](${iconURL})   ` : '';
    const bannerLine = bannerURL ? `**🎨 Banner:** [View](${bannerURL})\n` : '';

    // ── In-memory chat stats ─────────────────────────────────────────────────
    const guildHistory      = state.chatHistories?.[guild.id] ?? {};
    let totalMessages       = 0;
    let userMessages        = 0;
    let botMessages         = 0;
    const activeChannels    = new Set();
    const channelMsgCounts  = {};

    for (const [channelId, messages] of Object.entries(guildHistory)) {
      if (!Array.isArray(messages)) continue;
      for (const msg of messages) {
        totalMessages++;
        if (msg.role === 'user') {
          userMessages++;
          activeChannels.add(channelId);
          channelMsgCounts[channelId] = (channelMsgCounts[channelId] ?? 0) + 1;
        } else if (msg.role === 'assistant') {
          botMessages++;
        }
      }
    }

    const mostActiveChannel = Object.entries(channelMsgCounts).sort(([, a], [, b]) => b - a)[0];
    const avgPerDay         = daysSince > 0 ? (totalMessages / daysSince).toFixed(1) : '0';
    const avgPerChannel     = activeChannels.size > 0
      ? (userMessages / activeChannels.size).toFixed(1)
      : '0';

    const topChannelLine = mostActiveChannel && activeChannels.size > 0
      ? `\n> 🏆  **Top Channel**   <#${mostActiveChannel[0]}> (${mostActiveChannel[1]} msgs)`
      : '';

    // ── Build container ──────────────────────────────────────────────────────
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);

    // — Banner image (if available) ——
    if (bannerURL) {
      const gallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerURL)
      );
      container.addMediaGalleryComponents(gallery);
    }

    // — Section 1: Overview ——
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${guild.name}\n` +
        (guild.description ? `*${guild.description}*\n\n` : '\n') +
        `${iconLine}${bannerLine}` +
        `> 🪪  \`${guild.id}\`\n` +
        `> 📅  Founded ${ts(guild.createdAt)}\n` +
        `> 🌐  Locale  \`${guild.preferredLocale}\``
      )
    );

    // — Section 2: Community ——
    addSection(container,
      `${heading('👥', 'Community')}\n\n` +
      `> 👤  **Members**   ${totalMembers.toLocaleString()}${memberNote}\n` +
      `> 👑  **Owner**     ${ownerTag}\n` +
      `> 🚀  **Boosts**    ${BOOST_TIER_LABELS[guild.premiumTier] ?? '○ None'}  ·  ${guild.premiumSubscriptionCount ?? 0} boost${guild.premiumSubscriptionCount !== 1 ? 's' : ''}\n` +
      `> 🛡️  **Verify**    ${VERIFICATION_LABELS[guild.verificationLevel] ?? guild.verificationLevel}\n` +
      `> 🔞  **Filter**    ${CONTENT_FILTER_LABELS[guild.explicitContentFilter] ?? guild.explicitContentFilter}\n` +
      `> ⚠️  **NSFW**      Level \`${guild.nsfwLevel}\``
    );

    // — Section 3: Structure ——
    addSection(container,
      `${heading('📐', 'Channels & Roles')}\n\n` +
      `> 💬  **Text**        ${textCount}   ` +
        `📢  **Announcements**  ${announcCount}\n` +
      `> 🔊  **Voice**       ${voiceCount}   ` +
        `🎙️  **Stage**           ${stageCount}\n` +
      `> 💬  **Forums**      ${forumCount}   ` +
        `📁  **Categories**     ${categoryCount}\n` +
      `> 📡  **Total Channels**   ${totalChannels}\n` +
      `> 🏷️  **Roles**            ${guild.roles.cache.size}\n` +
      `> 😀  **Emojis**           ${guild.emojis.cache.size}   ` +
        `🪄  **Stickers**  ${guild.stickers.cache.size}`
    );

    // — Section 4: Features ——
    addSection(container,
      `${heading('✨', 'Server Features')}\n\n` +
      activeFeatures
    );

    // — Section 5: Lumin stats ——
    addSection(container,
      `${heading('🤖', 'Lumin  ·  Server History')}\n\n` +
      `> 📆  **Joined**         ${ts(joinDate)}\n` +
      `> ⏳  **Together**       ${timeDisplay}  *(${daysSince} days)*\n` +
      `> 💬  **Messages**       ${totalMessages.toLocaleString()}  ·  👤 ${userMessages.toLocaleString()} user  /  🤖 ${botMessages.toLocaleString()} bot\n` +
      `> 📊  **Active Channels**  ${activeChannels.size}\n` +
      `> 📈  **Avg / Day**      ${avgPerDay}  ·  **Avg / Channel**  ${avgPerChannel}` +
      topChannelLine
    );

    // — Footer subtext ——
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Stats reflect in-memory conversation history · Updated live`
      )
    );

    await interaction.reply({ components: [container], flags: IS_COMPONENTS_V2 });

  } catch (error) {
    logger.error('handleAnniversaryCommand failed', error);
    const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Error**\nFailed to retrieve server details. Please try again later.')
    );
    await interaction.reply({ components: [container], flags: MessageFlags.Ephemeral | IS_COMPONENTS_V2 });
  }
}
