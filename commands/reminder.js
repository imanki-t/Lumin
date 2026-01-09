import { EmbedBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { state, saveStateToFile } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import * as db from '../database.js';
import { getUserTime } from './timezone.js';

const MAX_REMINDERS_PER_USER = 10;

export const reminderCommand = {
  name: 'reminder',
  description: 'Set reminders for yourself (max 10 reminders)'
};

export async function handleReminderCommand(interaction) {
  try {
    const userId = interaction.user.id;
    
    // Check current reminder count
    const currentReminders = state.reminders?.[userId] || [];
    const activeReminders = currentReminders.filter(r => r.active);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⏰ Reminder Setup')
      .setDescription(`Choose an action:\n\n**Active Reminders:** ${activeReminders.length}/${MAX_REMINDERS_PER_USER}`);

    const actionSelect = new StringSelectMenuBuilder()
      .setCustomId('reminder_action')
      .setPlaceholder('Select an action')
      .addOptions(
        { label: 'Add Reminder', value: 'add', description: 'Create a new reminder', emoji: '➕' },
        { label: 'View Reminders', value: 'view', description: 'See all your reminders', emoji: '📋' },
        { label: 'Delete Reminder', value: 'delete', description: 'Remove a reminder', emoji: '🗑️' }
      );

    const row = new ActionRowBuilder().addComponents(actionSelect);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('Error in handleReminderCommand:', error);
    await sendError(interaction, 'An error occurred processing the reminder command.');
  }
}

export async function handleReminderActionSelect(interaction) {
  try {
    const action = interaction.values[0];
    
    if (action === 'add') {
      await showReminderTypeSelect(interaction);
    } else if (action === 'view') {
      await viewReminders(interaction);
    } else if (action === 'delete') {
      await showDeleteReminderMenu(interaction);
    }
  } catch (error) {
    console.error('Error in handleReminderActionSelect:', error);
    await sendError(interaction, 'Failed to process your selection.', true);
  }
}

async function showReminderTypeSelect(interaction) {
  try {
    const userId = interaction.user.id;
    const currentReminders = state.reminders?.[userId] || [];
    const activeReminders = currentReminders.filter(r => r.active);
    
    if (activeReminders.length >= MAX_REMINDERS_PER_USER) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Reminder Limit Reached')
        .setDescription(`You have reached the maximum limit of ${MAX_REMINDERS_PER_USER} reminders.\n\nPlease delete some old reminders before creating new ones.`);
      
      const deleteButton = new ButtonBuilder()
        .setCustomId('reminder_action_delete')
        .setLabel('Delete Reminders')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');
      
      const row = new ActionRowBuilder().addComponents(deleteButton);
      
      return interaction.update({
        embeds: [embed],
        components: [row]
      });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⏰ Reminder Setup')
      .setDescription('Choose how often you want to be reminded:');

    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId('reminder_type')
      .setPlaceholder('Select reminder frequency')
      .addOptions(
        { label: 'Once (specific time)', value: 'once', description: 'One-time reminder', emoji: '⏱️' },
        { label: 'Daily', value: 'daily', description: 'Repeats every day', emoji: '📅' },
        { label: 'Weekly', value: 'weekly', description: 'Repeats every week', emoji: '📆' },
        { label: 'Monthly', value: 'monthly', description: 'Repeats every month', emoji: '🗓️' }
      );

    const row = new ActionRowBuilder().addComponents(typeSelect);

    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('Error in showReminderTypeSelect:', error);
    await sendError(interaction, 'Failed to show reminder types.', true);
  }
}

export async function handleReminderTypeSelect(interaction) {
  try {
    const type = interaction.values[0];
    
    const modal = new ModalBuilder()
      .setCustomId(`reminder_modal_${type}`)
      .setTitle(`Set ${type.charAt(0).toUpperCase() + type.slice(1)} Reminder`);

    const messageInput = new TextInputBuilder()
      .setCustomId('reminder_message')
      .setLabel('What should I remind you about?')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g., Take medication, Study for exam')
      .setRequired(true)
      .setMaxLength(500);

    let timeInput;
    if (type === 'once') {
      timeInput = new TextInputBuilder()
        .setCustomId('reminder_time')
        .setLabel('When? (YYYY-MM-DD HH:MM AM/PM)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 2024-12-25 02:30 PM')
        .setRequired(true);
    } else if (type === 'daily') {
      timeInput = new TextInputBuilder()
        .setCustomId('reminder_time')
        .setLabel('What time? (HH:MM AM/PM)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 09:00 AM, 14:30, 8:00 PM')
        .setRequired(true);
    } else if (type === 'weekly') {
      timeInput = new TextInputBuilder()
        .setCustomId('reminder_time')
        .setLabel('Day and time? (Day HH:MM AM/PM)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Monday 09:00 AM, Friday 5:00 PM')
        .setRequired(true);
    } else if (type === 'monthly') {
      timeInput = new TextInputBuilder()
        .setCustomId('reminder_time')
        .setLabel('Day and time? (Day HH:MM AM/PM)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 1 09:00 AM, 15 2:00 PM')
        .setRequired(true);
    }

    modal.addComponents(
      new ActionRowBuilder().addComponents(messageInput),
      new ActionRowBuilder().addComponents(timeInput)
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error('Error in handleReminderTypeSelect:', error);
    await sendError(interaction, 'Failed to show reminder modal.', true);
  }
}

export async function handleReminderModal(interaction) {
  try {
    const [_, __, type] = interaction.customId.split('_');
    const message = interaction.fields.getTextInputValue('reminder_message');
    const timeStr = interaction.fields.getTextInputValue('reminder_time');
    
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⏰ Reminder Location')
      .setDescription(`**Reminder:** ${message}\n**Type:** ${type}\n**Time:** ${timeStr}\n\nWhere should I send this reminder?`);

    const uniqueStepId = `${userId}_${Date.now()}`;
    const locationSelect = new StringSelectMenuBuilder()
      .setCustomId(`reminder_location_${uniqueStepId}`)
      .setPlaceholder('Choose notification location');
    
    if (guildId) {
      locationSelect.addOptions(
        { label: 'DM Only', value: 'dm', description: 'Receive in direct messages', emoji: '📬' },
        { label: 'Server Only', value: 'server', description: 'Get notified in this server', emoji: '💬' },
        { label: 'Both', value: 'both', description: 'DM + Server notification', emoji: '📢' }
      );
    } else {
      locationSelect.addOptions(
        { label: 'DM', value: 'dm', description: 'Receive in direct messages', emoji: '📬' }
      );
    }

    const row = new ActionRowBuilder().addComponents(locationSelect);

    if (!interaction.client.tempReminderData) {
      interaction.client.tempReminderData = new Map();
    }
    
    interaction.client.tempReminderData.set(uniqueStepId, {
      type,
      message,
      timeStr,
      guildId,
      userId
    });

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    });
    
    setTimeout(() => {
      interaction.client.tempReminderData.delete(uniqueStepId);
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error in handleReminderModal:', error);
    await sendError(interaction, 'Failed to process reminder details.');
  }
}

export async function handleReminderLocationSelect(interaction) {
  try {
    const uniqueStepId = interaction.customId.replace('reminder_location_', '');
    const userId = interaction.user.id;
    
    const tempData = interaction.client.tempReminderData?.get(uniqueStepId);
    
    if (!tempData) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Expired')
        .setDescription('This reminder setup has expired. Please start again with `/reminder`');
      
      return interaction.update({
        embeds: [embed],
        components: []
      });
    }

    if (tempData.userId !== userId) {
      return interaction.reply({
        content: 'This interaction does not belong to you.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    const { type, message, timeStr, guildId } = tempData;
    const location = interaction.values[0];
    
    try {
      // Parse the time string into components (year, month, day, hour, minute)
      const parsedTime = parseReminderTime(type, timeStr);
      
      if (!state.reminders) {
        state.reminders = {};
      }
      
      if (!state.reminders[userId]) {
        state.reminders[userId] = [];
      }
      
      const activeReminders = state.reminders[userId].filter(r => r.active);
      if (activeReminders.length >= MAX_REMINDERS_PER_USER) {
        const embed = new EmbedBuilder()
          .setColor(0xFF5555)
          .setTitle('❌ Reminder Limit Reached')
          .setDescription(`You have reached the maximum limit of ${MAX_REMINDERS_PER_USER} reminders.`);
        
        return interaction.update({
          embeds: [embed],
          components: []
        });
      }
      
      const reminder = {
        id: `${userId}_${Date.now()}`,
        type,
        message,
        time: parsedTime, // Stores components like { hour: 14, minute: 30 }
        location,
        guildId: location !== 'dm' ? guildId : null,
        active: true,
        createdAt: Date.now()
      };
      
      state.reminders[userId].push(reminder);
      await db.saveReminder(userId, reminder);
      await saveStateToFile();
      
      scheduleReminder(interaction.client, reminder);
      memorySystem.invalidatePersonalDataCache(userId);
      
      const locationText = {
        dm: 'DMs',
        server: 'this server',
        both: 'DMs and this server'
      }[location];
      
      const timeDisplay = formatReminderTime(type, parsedTime);
      const activeCount = state.reminders[userId].filter(r => r.active).length;
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Reminder Set!')
        .setDescription(`**Message:** ${message}\n**Type:** ${type}\n**Trigger:** ${timeDisplay}\n**Location:** ${locationText}`)
        .setFooter({ text: `Active reminders: ${activeCount}/${MAX_REMINDERS_PER_USER}` });

      interaction.client.tempReminderData.delete(uniqueStepId);

      await interaction.update({
        embeds: [embed],
        components: []
      });
      
    } catch (parseError) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Invalid Time Format')
        .setDescription(`Could not parse the time: "${timeStr}"\n\n${parseError.message}\n\nCheck for correct AM/PM format.`);

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } catch (error) {
    console.error('Error in handleReminderLocationSelect:', error);
    await sendError(interaction, 'Failed to save reminder.', true);
  }
}

async function viewReminders(interaction) {
  try {
    const userId = interaction.user.id;
    const reminders = state.reminders?.[userId] || [];
    const activeReminders = reminders.filter(r => r.active);
    
    if (activeReminders.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('📋 No Active Reminders')
        .setDescription('You don\'t have any active reminders.\n\nUse `/reminder` to create one!');
      
      return interaction.update({
        embeds: [embed],
        components: []
      });
    }
    
    const reminderList = activeReminders
      .map((reminder, index) => {
        const timeDisplay = formatReminderTime(reminder.type, reminder.time);
        return `**${index + 1}.** ${reminder.message}\n⏰ ${timeDisplay}\n📍 ${reminder.location === 'dm' ? 'DMs' : reminder.location === 'both' ? 'DMs & Server' : 'Server'}`;
      })
      .join('\n\n');
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Your Active Reminders')
      .setDescription(reminderList)
      .setFooter({ text: `${activeReminders.length}/${MAX_REMINDERS_PER_USER} reminders active` });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  } catch (error) {
    console.error('Error in viewReminders:', error);
    await sendError(interaction, 'Failed to view reminders.', true);
  }
}

async function showDeleteReminderMenu(interaction) {
  try {
    const userId = interaction.user.id;
    const reminders = state.reminders?.[userId] || [];
    const activeReminders = reminders.filter(r => r.active);
    
    if (activeReminders.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ No Reminders')
        .setDescription('You don\'t have any active reminders to delete.');
      
      return interaction.update({
        embeds: [embed],
        components: []
      });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🗑️ Delete Reminder')
      .setDescription('Select a reminder to delete:');

    const deleteSelect = new StringSelectMenuBuilder()
      .setCustomId('reminder_delete_select')
      .setPlaceholder('Choose reminder to delete')
      .addOptions(
        activeReminders.slice(0, 25).map((reminder, index) => ({
          label: `${index + 1}. ${reminder.message.slice(0, 50)}`,
          description: formatReminderTime(reminder.type, reminder.time).slice(0, 100),
          value: reminder.id
        }))
      );

    const row = new ActionRowBuilder().addComponents(deleteSelect);

    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('Error in showDeleteReminderMenu:', error);
    await sendError(interaction, 'Failed to show delete menu.', true);
  }
}

export async function handleReminderDeleteSelect(interaction) {
  try {
    const reminderId = interaction.values[0];
    const userId = interaction.user.id;
    
    const reminderIndex = state.reminders?.[userId]?.findIndex(r => r.id === reminderId);
    
    if (reminderIndex === undefined || reminderIndex === -1) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Reminder Not Found')
        .setDescription('Could not find that reminder.');
      return interaction.update({ embeds: [embed], components: [] });
    }
    
    const reminder = state.reminders[userId][reminderIndex];
    
    // Remove from state array entirely (hard delete from memory)
    state.reminders[userId].splice(reminderIndex, 1);
    
    // Clear interval if exists
    if (interaction.client.reminderIntervals?.has(reminderId)) {
      clearInterval(interaction.client.reminderIntervals.get(reminderId));
      interaction.client.reminderIntervals.delete(reminderId);
    }
    
    // Delete from DB (hard delete)
    await db.deleteReminder(reminderId);
    await saveStateToFile();
    
    memorySystem.invalidatePersonalDataCache(userId);
    
    const activeCount = state.reminders[userId].filter(r => r.active).length;
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Reminder Deleted')
      .setDescription(`Deleted: **${reminder.message}**`)
      .setFooter({ text: `Active reminders: ${activeCount}/${MAX_REMINDERS_PER_USER}` });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  } catch (error) {
    console.error('Error in handleReminderDeleteSelect:', error);
    await sendError(interaction, 'Failed to delete reminder.', true);
  }
}

// Updated to support AM/PM and 12-hour format
function parseReminderTime(type, timeStr) {
  // Helper to convert 12h to 24h
  const to24Hour = (hour, ampm) => {
    hour = parseInt(hour);
    if (!ampm) return hour;
    const isPM = ampm.toUpperCase() === 'PM';
    if (isPM && hour < 12) return hour + 12;
    if (!isPM && hour === 12) return 0;
    return hour;
  };

  const ampmRegex = /\s*([AaPp][Mm])?$/;

  if (type === 'once') {
    // Format: YYYY-MM-DD HH:MM [AM/PM]
    const match = timeStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    if (!match) throw new Error('Format: YYYY-MM-DD HH:MM (AM/PM) (e.g., 2024-12-25 02:30 PM)');
    
    const [, year, month, day, hourStr, minute, ampm] = match;
    const hour = to24Hour(hourStr, ampm);
    
    // Validate future time roughly (exact validation happens at runtime with timezone)
    // We store components
    return { 
      year: parseInt(year), 
      month: parseInt(month), 
      day: parseInt(day), 
      hour, 
      minute: parseInt(minute) 
    };
    
  } else if (type === 'daily') {
    // Format: HH:MM [AM/PM]
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    if (!match) throw new Error('Format: HH:MM (AM/PM) (e.g., 09:00 AM, 14:30)');
    
    const [, hourStr, minute, ampm] = match;
    const hour = to24Hour(hourStr, ampm);
    return { hour, minute: parseInt(minute) };
    
  } else if (type === 'weekly') {
    // Format: Day HH:MM [AM/PM]
    const match = timeStr.match(/(\w+)\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    if (!match) throw new Error('Format: DayName HH:MM (AM/PM) (e.g., Monday 09:00 AM)');
    
    const [, dayName, hourStr, minute, ampm] = match;
    const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    const day = dayMap[dayName.toLowerCase()];
    
    if (day === undefined) throw new Error('Invalid day. Use: Monday, Tuesday, etc.');
    const hour = to24Hour(hourStr, ampm);
    
    return { day, hour, minute: parseInt(minute) };
    
  } else if (type === 'monthly') {
    // Format: DD HH:MM [AM/PM]
    const match = timeStr.match(/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
    if (!match) throw new Error('Format: DD HH:MM (AM/PM) (e.g., 15 09:00 AM)');
    
    const [, day, hourStr, minute, ampm] = match;
    const hour = to24Hour(hourStr, ampm);

    if (parseInt(day) < 1 || parseInt(day) > 31) throw new Error('Day must be 1-31');
    
    return { day: parseInt(day), hour, minute: parseInt(minute) };
  }
}

function formatReminderTime(type, t) {
  const formatTime = (h, m) => {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  if (type === 'once') {
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${formatTime(t.hour, t.minute)}`;
  } else if (type === 'daily') {
    return `Every day at ${formatTime(t.hour, t.minute)}`;
  } else if (type === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Every ${days[t.day]} at ${formatTime(t.hour, t.minute)}`;
  } else if (type === 'monthly') {
    return `${t.day}th of every month at ${formatTime(t.hour, t.minute)}`;
  }
}

export function scheduleReminder(client, reminder) {
  const checkAndTrigger = async () => {
    if (!reminder.active) return;
    
    const userId = reminder.id.split('_')[0];
    
    // CRITICAL: Get time in the USER'S timezone, not server time
    const userNow = getUserTime(userId);
    
    let shouldTrigger = false;
    
    if (reminder.type === 'once') {
      // Compare components because we stored them as "User Time Components"
      const nowComponents = {
        y: userNow.getFullYear(),
        m: userNow.getMonth() + 1,
        d: userNow.getDate(),
        h: userNow.getHours(),
        min: userNow.getMinutes()
      };

      // Check if current time matches OR is past the target time
      // Construct comparable integers (YYYYMMDDHHMM)
      const nowVal = nowComponents.y * 100000000 + nowComponents.m * 1000000 + nowComponents.d * 10000 + nowComponents.h * 100 + nowComponents.min;
      const targetVal = reminder.time.year * 100000000 + reminder.time.month * 1000000 + reminder.time.day * 10000 + reminder.time.hour * 100 + reminder.time.minute;

      if (nowVal >= targetVal) {
        shouldTrigger = true;
      }
    } else if (reminder.type === 'daily') {
      if (userNow.getHours() === reminder.time.hour && userNow.getMinutes() === reminder.time.minute) {
        shouldTrigger = true;
      }
    } else if (reminder.type === 'weekly') {
      if (userNow.getDay() === reminder.time.day && 
          userNow.getHours() === reminder.time.hour && 
          userNow.getMinutes() === reminder.time.minute) {
        shouldTrigger = true;
      }
    } else if (reminder.type === 'monthly') {
      if (userNow.getDate() === reminder.time.day && 
          userNow.getHours() === reminder.time.hour && 
          userNow.getMinutes() === reminder.time.minute) {
        shouldTrigger = true;
      }
    }
    
    if (shouldTrigger) {
      await sendReminder(client, reminder);
      
      if (reminder.type === 'once') {
        // Completely delete 'once' reminders after triggering
        const rIndex = state.reminders[userId]?.findIndex(r => r.id === reminder.id);
        if (rIndex !== -1) {
          state.reminders[userId].splice(rIndex, 1);
        }
        
        // Hard delete from DB
        await db.deleteReminder(reminder.id);
        await saveStateToFile();
        
        // Clear this specific interval
        if (client.reminderIntervals?.has(reminder.id)) {
          clearInterval(client.reminderIntervals.get(reminder.id));
          client.reminderIntervals.delete(reminder.id);
        }
        
        memorySystem.invalidatePersonalDataCache(userId);
      }
    }
  };
  
  // Check every 45 seconds to avoid missing the minute mark due to execution drift
  const intervalId = setInterval(checkAndTrigger, 45 * 1000);
  
  if (!client.reminderIntervals) {
    client.reminderIntervals = new Map();
  }
  client.reminderIntervals.set(reminder.id, intervalId);
}

async function sendReminder(client, reminder) {
  const userId = reminder.id.split('_')[0];
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;
  
  const embed = new EmbedBuilder()
    .setColor(0xFF8C00)
    .setTitle('⏰ Reminder!')
    .setDescription(reminder.message)
    .setFooter({ text: `Type: ${reminder.type}` })
    .setTimestamp();
  
  // Send to DM
  if (reminder.location === 'dm' || reminder.location === 'both') {
    try {
      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Could not send reminder DM to ${userId}:`, error);
    }
  }
  
  // Send to server
  if ((reminder.location === 'server' || reminder.location === 'both') && reminder.guildId) {
    try {
      const guild = client.guilds.cache.get(reminder.guildId);
      if (guild) {
        const channel = guild.channels.cache.find(ch => 
          ch.isTextBased() && 
          ch.permissionsFor(guild.members.me).has('SendMessages')
        );
        
        if (channel) {
          await channel.send({
            content: `<@${userId}>`,
            embeds: [embed]
          });
        }
      }
    } catch (error) {
      console.error(`Could not send reminder in server ${reminder.guildId}:`, error);
    }
  }
}

export function initializeReminders(client) {
  if (!state.reminders) return;
  
  for (const userId in state.reminders) {
    for (const reminder of state.reminders[userId]) {
      if (reminder.active) {
        scheduleReminder(client, reminder);
      }
    }
  }
}

async function sendError(interaction, message, isUpdate = false) {
  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('❌ Error')
    .setDescription(message);
    
  try {
    if (isUpdate) {
      await interaction.update({ embeds: [embed], components: [] });
    } else {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components: [] });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }
  } catch (e) {
    console.error('Failed to send error message:', e);
  }
}
