import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { state, saveStateToFile } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import * as db from '../database.js';

export const timezoneCommand = {
  name: 'timezone',
  description: 'Set your timezone for time-based features (birthdays, reminders, quotes)'
};

// Initial Command - Direct to Custom Timezone
export async function handleTimezoneCommand(interaction) {
  const userId = interaction.user.id;
  const currentTz = state.userTimezones?.[userId] || 'Not set (using UTC)';
  
  let currentTime;
  try {
    const tz = state.userTimezones?.[userId] || 'UTC';
    currentTime = new Date().toLocaleString('en-US', { 
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'short'
    });
  } catch (e) {
    currentTime = 'Unknown';
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🌍 Timezone Setup')
    .setDescription(`Set your timezone to ensure reminders and events happen at your local time.\n\n**Current Setting:** \`${currentTz}\`\n**Your Time:** ${currentTime}`)
    .setFooter({ text: 'We use standard IANA timezone IDs (e.g., America/New_York)' });

  const customButton = new ButtonBuilder()
    .setCustomId('timezone_custom')
    .setLabel('Set Custom Timezone')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('⌨️');

  const row = new ActionRowBuilder().addComponents(customButton);

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

// Handler for the "Set Custom Timezone" button (triggered from the embed above or settings)
export async function handleTimezoneCustomButton(interaction) {
  const userId = interaction.user.id;
  // Retrieve the existing timezone from state
  const currentTz = state.userTimezones?.[userId] || '';

  const modal = new ModalBuilder()
    .setCustomId('timezone_modal')
    .setTitle('Set Timezone');

  const input = new TextInputBuilder()
    .setCustomId('timezone_input')
    .setLabel('Enter IANA Timezone ID')
    .setPlaceholder('e.g., America/New_York, Asia/Tokyo, UTC')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  // Set the old value if it exists so the user can see/edit it
  if (currentTz) {
    input.setValue(currentTz);
  }

  const row = new ActionRowBuilder().addComponents(input);
  modal.addComponents(row);

  await interaction.showModal(modal);
}


// Handler for the Modal Submission
export async function handleTimezoneCustomModal(interaction) {
  const timezoneInput = interaction.fields.getTextInputValue('timezone_input').trim();
  const userId = interaction.user.id;

  // Validate Timezone using Intl.DateTimeFormat
  // This checks if the node environment (server) supports the timezone
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezoneInput });
    const resolvedOptions = formatter.resolvedOptions();
    const validTimezone = resolvedOptions.timeZone;

    await saveTimezone(userId, validTimezone);
    
    // Invalidate cache immediately after saving
    memorySystem.invalidatePersonalDataCache(userId);
    
    const currentTime = new Date().toLocaleString('en-US', { 
      timeZone: validTimezone,
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Timezone Set')
      .setDescription(`Your timezone has been updated to **${validTimezone}**`)
      .addFields({
        name: '🕐 Current Local Time',
        value: currentTime
      })
      .setFooter({ text: 'All reminders and schedules will now follow this timezone.' });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });

  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Invalid Timezone')
      .setDescription(`\`${timezoneInput}\` is not a valid timezone identifier supported by this server.\n\n**Common Examples:**\n\`America/New_York\`\n\`Europe/London\`\n\`Asia/Tokyo\`\n\`Australia/Sydney\`\n\`UTC\``);

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
}

// Unused handlers kept to prevent import errors in index.js if referenced, 
// but they won't be triggered by the new UI.
export async function handleTimezoneSelect(interaction) {}
export async function handleTimezoneNextPage(interaction) {}
export async function handleTimezonePrevPage(interaction) {}

// Helpers
async function saveTimezone(userId, timezone) {
  if (!state.userTimezones) {
    state.userTimezones = {};
  }
  state.userTimezones[userId] = timezone;
  await db.saveUserTimezone(userId, timezone);
  await saveStateToFile();
}

/**
 * Returns a Date object representing the current time in the user's timezone.
 * Note: The timestamp of this object is shifted. Use getters (getHours, etc.) on this object.
 */
export function getUserTime(userId, date = new Date()) {
  const timezone = state.userTimezones?.[userId] || 'UTC';
  try {
    // Create a date string in the user's timezone
    const userDateString = date.toLocaleString('en-US', { timeZone: timezone });
    // Parse that string back into a Date object
    return new Date(userDateString);
  } catch (error) {
    console.error('Error getting user time:', error);
    return date;
  }
}

export function isUserHour(userId, targetHour) {
  const userTime = getUserTime(userId);
  return userTime.getHours() === targetHour;
}

export function getUserMidnight(userId) {
  const userNow = getUserTime(userId);
  userNow.setHours(0, 0, 0, 0);
  return userNow;
}

export function formatTimeForUser(userId, date) {
  const timezone = state.userTimezones?.[userId] || 'UTC';
  try {
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch (error) {
    return date.toLocaleString();
  }
}
