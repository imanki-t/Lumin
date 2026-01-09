import { EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { state, saveStateToFile, genAI } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import * as db from '../database.js';
import { getUserTime } from './timezone.js';

const BIRTHDAY_MODEL = 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = 'gemini-2.5-flash';
const MAX_BIRTHDAYS_PER_USER = 5;
const BIRTHDAY_WISH_DELAY_MS = 2000; // 2-second delay between wishes

export const birthdayCommand = {
  name: 'birthday',
  description: 'Manage your birthday reminders (max 5 birthdays)',
  options: [
    {
      name: 'action',
      description: 'What do you want to do?',
      type: 3,
      required: true,
      choices: [
        { name: 'Set Birthday', value: 'set' },
        { name: 'Remove Birthday', value: 'remove' },
        { name: 'List Birthdays', value: 'list' }
      ]
    }
  ]
};

export async function handleBirthdayCommand(interaction) {
  try {
    const action = interaction.options.getString('action');
    
    if (action === 'set') {
      await showBirthdaySetup(interaction);
    } else if (action === 'remove') {
      await removeBirthday(interaction);
    } else if (action === 'list') {
      await listBirthdays(interaction, 0);
    }
  } catch (error) {
    console.error('Error in handleBirthdayCommand:', error);
    await sendError(interaction, 'An error occurred while processing the birthday command.');
  }
}

async function showBirthdaySetup(interaction) {
  try {
    const userId = interaction.user.id;
    
    if (!state.birthdays) {
      state.birthdays = {};
    }
    
    const userBirthdays = Object.keys(state.birthdays).filter(key => key.startsWith(userId)).length;
    
    if (userBirthdays >= MAX_BIRTHDAYS_PER_USER) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Birthday Limit Reached')
        .setDescription(`You have reached the maximum limit of ${MAX_BIRTHDAYS_PER_USER} birthdays.\n\nPlease remove some birthdays before adding new ones using \`/birthday action:remove\``);
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎂 Birthday Setup')
      .setDescription(`Let's set up a birthday reminder!\n\n**Birthdays set:** ${userBirthdays}/${MAX_BIRTHDAYS_PER_USER}\n\nPlease select the birth month first:`)
      .setFooter({ text: 'Your birthday will never be shared without permission' });

    const monthSelect = new StringSelectMenuBuilder()
      .setCustomId('birthday_month')
      .setPlaceholder('Select birth month')
      .addOptions(
        { label: 'January', value: '01', emoji: '❄️' },
        { label: 'February', value: '02', emoji: '💝' },
        { label: 'March', value: '03', emoji: '🌸' },
        { label: 'April', value: '04', emoji: '🌷' },
        { label: 'May', value: '05', emoji: '🌺' },
        { label: 'June', value: '06', emoji: '☀️' },
        { label: 'July', value: '07', emoji: '🎆' },
        { label: 'August', value: '08', emoji: '🏖️' },
        { label: 'September', value: '09', emoji: '🍂' },
        { label: 'October', value: '10', emoji: '🎃' },
        { label: 'November', value: '11', emoji: '🍁' },
        { label: 'December', value: '12', emoji: '🎄' }
      );

    const row = new ActionRowBuilder().addComponents(monthSelect);

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
      fetchReply: true
    });
    
    // Set 5-minute expiry
    setTimeout(async () => {
      try {
        await interaction.deleteReply().catch(() => {});
      } catch (error) {}
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error in showBirthdaySetup:', error);
    await sendError(interaction, 'Failed to start birthday setup.');
  }
}

function getDaysInMonth(month) {
  const monthNum = parseInt(month);
  if (monthNum === 2) return 29;
  if ([4, 6, 9, 11].includes(monthNum)) return 30;
  return 31;
}

export async function handleBirthdayMonthSelect(interaction) {
  try {
    const month = interaction.values[0];
    const maxDays = getDaysInMonth(month);
    
    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎂 Birthday Setup - Day')
      .setDescription(`You selected **${getMonthName(month)}**.\nNow select the day of the month:`);

    const daySelect1 = new StringSelectMenuBuilder()
      .setCustomId(`birthday_day_${month}_1`)
      .setPlaceholder('Select day (1-15)')
      .addOptions(
        Array.from({ length: 15 }, (_, i) => ({
          label: String(i + 1),
          value: String(i + 1).padStart(2, '0')
        }))
      );

    const remainingDays = maxDays - 15;
    const daySelect2 = new StringSelectMenuBuilder()
      .setCustomId(`birthday_day_${month}_2`)
      .setPlaceholder(`Select day (16-${maxDays})`)
      .addOptions(
        Array.from({ length: remainingDays }, (_, i) => ({
          label: String(i + 16),
          value: String(i + 16).padStart(2, '0')
        }))
      );

    const row1 = new ActionRowBuilder().addComponents(daySelect1);
    const row2 = new ActionRowBuilder().addComponents(daySelect2);

    await interaction.update({
      embeds: [embed],
      components: [row1, row2]
    });
  } catch (error) {
    console.error('Error in handleBirthdayMonthSelect:', error);
    await sendError(interaction, 'Failed to update birthday month selection.', true);
  }
}

export async function handleBirthdayDaySelect(interaction) {
  try {
    const parts = interaction.customId.split('_');
    const month = parts[2]; 
    const day = interaction.values[0];
    
    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎂 Birthday Setup - Person\'s Name')
      .setDescription(`Birthday: **${getMonthName(month)} ${parseInt(day)}**\n\nWhose birthday is this?`);

    const nameSelect = new StringSelectMenuBuilder()
      .setCustomId(`birthday_name_${month}_${day}`)
      .setPlaceholder('Choose whose birthday this is')
      .addOptions(
        { label: 'My Birthday', value: 'self', description: 'This is your own birthday', emoji: '🎂' },
        { label: 'Someone Else\'s Birthday', value: 'other', description: 'Track someone else\'s birthday', emoji: '👥' }
      );

    const row = new ActionRowBuilder().addComponents(nameSelect);

    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('Error in handleBirthdayDaySelect:', error);
    await sendError(interaction, 'Failed to update birthday day selection.', true);
  }
}

export async function handleBirthdayNameSelect(interaction) {
  try {
    const parts = interaction.customId.split('_');
    const month = parts[2];
    const day = parts[3];
    const nameType = interaction.values[0];
    
    const guildId = interaction.guild?.id;
    
    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎂 Birthday Setup - Notification Preferences')
      .setDescription(`Birthday: **${getMonthName(month)} ${parseInt(day)}**\nFor: **${nameType === 'self' ? 'You' : 'Someone else'}**\n\nWhere should I send birthday notifications?`);

    const preferenceSelect = new StringSelectMenuBuilder()
      .setCustomId(`birthday_pref_${month}_${day}_${nameType}`)
      .setPlaceholder('Choose notification preference');
    
    if (guildId) {
      preferenceSelect.addOptions(
        { label: 'DMs Only', value: 'dm', description: 'Receive wishes in direct messages', emoji: '📬' },
        { label: 'Server Only', value: 'server', description: 'Get celebrated in the server', emoji: '🎉' },
        { label: 'Both', value: 'both', description: 'DM + Server celebration', emoji: '🎊' }
      );
    } else {
      preferenceSelect.addOptions(
        { label: 'DM', value: 'dm', description: 'Receive wishes in direct messages', emoji: '📬' }
      );
    }

    const row = new ActionRowBuilder().addComponents(preferenceSelect);

    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('Error in handleBirthdayNameSelect:', error);
    await sendError(interaction, 'Failed to update birthday name selection.', true);
  }
}

export async function handleBirthdayPrefSelect(interaction) {
  try {
    const parts = interaction.customId.split('_');
    const month = parts[2];
    const day = parts[3];
    const nameType = parts[4];
    const preference = interaction.values[0];
    
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    
    if (!state.birthdays) {
      state.birthdays = {};
    }
    
    const userBirthdays = Object.keys(state.birthdays).filter(key => key.startsWith(userId)).length;
    
    if (userBirthdays >= MAX_BIRTHDAYS_PER_USER) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Birthday Limit Reached')
        .setDescription(`You have reached the maximum limit of ${MAX_BIRTHDAYS_PER_USER} birthdays.`);
      
      return interaction.update({
        embeds: [embed],
        components: []
      });
    }
    
    const birthdayKey = `${userId}_${month}_${day}`;
    
    state.birthdays[birthdayKey] = {
      month,
      day,
      preference,
      guildId: preference !== 'dm' ? guildId : null,
      year: null,
      nameType,
      ownerUsername: interaction.user.username
    };
    
    await db.saveBirthday(birthdayKey, state.birthdays[birthdayKey]);
    await saveStateToFile();
    
    memorySystem.invalidatePersonalDataCache(userId);
    
    const prefText = {
      dm: 'DMs only',
      server: 'this server only',
      both: 'DMs and this server'
    }[preference];
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Birthday Saved!')
      .setDescription(`Birthday set for **${getMonthName(month)} ${parseInt(day)}**!\n\nYou'll receive birthday notifications via: **${prefText}** 🎂`)
      .setFooter({ text: `${userBirthdays + 1}/${MAX_BIRTHDAYS_PER_USER} birthdays set • Change anytime with /birthday` });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  } catch (error) {
    console.error('Error in handleBirthdayPrefSelect:', error);
    await sendError(interaction, 'Failed to save birthday preference.', true);
  }
}

async function removeBirthday(interaction) {
  try {
    const userId = interaction.user.id;
    
    if (!state.birthdays) {
      state.birthdays = {};
    }
    
    const userBirthdays = Object.keys(state.birthdays).filter(key => key.startsWith(userId));
    
    if (userBirthdays.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ No Birthdays Found')
        .setDescription('You don\'t have any birthdays set up yet!\n\nUse `/birthday action:set` to add one.');
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
    
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🗑️ Remove Birthday')
      .setDescription('Select which birthday to remove:');

    const deleteSelect = new StringSelectMenuBuilder()
      .setCustomId('birthday_delete_select')
      .setPlaceholder('Choose birthday to remove')
      .addOptions(
        userBirthdays.slice(0, 25).map(key => {
          const birthday = state.birthdays[key];
          return {
            label: `${getMonthName(birthday.month)} ${parseInt(birthday.day)}`,
            description: `${birthday.nameType === 'self' ? 'Your birthday' : 'Someone else\'s birthday'}`,
            value: key
          };
        })
      );

    const row = new ActionRowBuilder().addComponents(deleteSelect);

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
      fetchReply: true
    });
    
    // Set 5-minute expiry
    setTimeout(async () => {
      try {
        await interaction.deleteReply().catch(() => {});
      } catch (error) {}
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error in removeBirthday:', error);
    await sendError(interaction, 'Failed to load birthdays for removal.');
  }
}

export async function handleBirthdayDeleteSelect(interaction) {
  try {
    const birthdayKey = interaction.values[0];
    
    if (!state.birthdays?.[birthdayKey]) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Birthday Not Found')
        .setDescription('Could not find that birthday.');
      
      return interaction.update({
        embeds: [embed],
        components: []
      });
    }
    
    const birthday = state.birthdays[birthdayKey];
    delete state.birthdays[birthdayKey];
    await db.deleteBirthday(birthdayKey);
    await saveStateToFile();
    
    memorySystem.invalidatePersonalDataCache(interaction.user.id);
    
    const userId = interaction.user.id;
    const remaining = Object.keys(state.birthdays).filter(key => key.startsWith(userId)).length;
    
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('✅ Birthday Removed')
      .setDescription(`Birthday on **${getMonthName(birthday.month)} ${parseInt(birthday.day)}** has been removed.`)
      .setFooter({ text: `${remaining}/${MAX_BIRTHDAYS_PER_USER} birthdays remaining` });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  } catch (error) {
    console.error('Error in handleBirthdayDeleteSelect:', error);
    await sendError(interaction, 'Failed to delete birthday.', true);
  }
}

async function listBirthdays(interaction, page = 0) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild?.id;
    const isDM = !guildId;
    
    if (!state.birthdays || Object.keys(state.birthdays).length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('📅 No Birthdays')
        .setDescription('No birthdays have been set yet!\n\nBe the first with `/birthday action:set`');
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }
    
    if (isDM) {
      const userBirthdays = [];
      const currentMonth = new Date().getMonth() + 1;
      
      for (const [key, data] of Object.entries(state.birthdays)) {
        if (key.startsWith(userId)) {
          userBirthdays.push({
            month: data.month,
            day: data.day,
            monthNum: parseInt(data.month),
            nameType: data.nameType,
            preference: data.preference
          });
        }
      }
      
      if (userBirthdays.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xFF5555)
          .setTitle('📅 No Birthdays')
          .setDescription('You haven\'t set any birthdays yet.\n\nUse `/birthday action:set` to add one!');
        
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      
      userBirthdays.sort((a, b) => {
        if (a.monthNum !== b.monthNum) return a.monthNum - b.monthNum;
        return parseInt(a.day) - parseInt(b.day);
      });
      
      const birthdayList = userBirthdays
        .map(b => {
          const forWhom = b.nameType === 'self' ? 'You' : 'Someone else';
          const location = b.preference === 'dm' ? 'DMs' : b.preference === 'both' ? 'DMs & Server' : 'Server';
          return `🎂 **${getMonthName(b.month)} ${parseInt(b.day)}** - ${forWhom} (${location})`;
        })
        .join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('🎉 Your Birthdays')
        .setDescription(birthdayList || 'No birthdays to display')
        .setFooter({ text: `${userBirthdays.length}/${MAX_BIRTHDAYS_PER_USER} birthdays set` });

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    } else {
      const birthdays = [];
      const currentMonth = new Date().getMonth() + 1;
      
      for (const [key, data] of Object.entries(state.birthdays)) {
        if (guildId && data.guildId === guildId && (data.preference === 'server' || data.preference === 'both')) {
          birthdays.push({
            username: data.ownerUsername || 'User',
            month: data.month,
            day: data.day,
            monthNum: parseInt(data.month),
            nameType: data.nameType
          });
        }
      }
      
      if (birthdays.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xFF5555)
          .setTitle('📅 No Server Birthdays')
          .setDescription('No birthdays are set to be celebrated in this server.');
        
        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }
      
      birthdays.sort((a, b) => {
        if (a.monthNum !== b.monthNum) return a.monthNum - b.monthNum;
        return parseInt(a.day) - parseInt(b.day);
      });
      
      const upcomingBirthdays = birthdays.filter(b => 
        b.monthNum > currentMonth || (b.monthNum === currentMonth && parseInt(b.day) >= new Date().getDate())
      );
      
      const pastBirthdays = birthdays.filter(b => 
        b.monthNum < currentMonth || (b.monthNum === currentMonth && parseInt(b.day) < new Date().getDate())
      );
      
      const sortedBirthdays = [...upcomingBirthdays, ...pastBirthdays];
      
      // Pagination logic
      const ITEMS_PER_PAGE = 10;
      const totalPages = Math.ceil(sortedBirthdays.length / ITEMS_PER_PAGE);
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      
      const startIdx = currentPage * ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sortedBirthdays.length);
      const pageItems = sortedBirthdays.slice(startIdx, endIdx);
      
      const birthdayList = pageItems
        .map(b => `🎂 **${b.username}** - ${getMonthName(b.month)} ${parseInt(b.day)}`)
        .join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('🎉 Server Birthdays')
        .setDescription(birthdayList || 'No birthdays to display')
        .setFooter({ text: `Page ${currentPage + 1}/${totalPages} • ${sortedBirthdays.length} birthday${sortedBirthdays.length !== 1 ? 's' : ''} registered` });

      const components = [];
      
      if (totalPages > 1) {
        const row1 = new ActionRowBuilder();
        
        const prevButton = new ButtonBuilder()
          .setCustomId(`birthday_list_prev_${currentPage}_${guildId}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⬅️')
          .setDisabled(currentPage === 0);
        
        const nextButton = new ButtonBuilder()
          .setCustomId(`birthday_list_next_${currentPage}_${guildId}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('➡️')
          .setDisabled(currentPage === totalPages - 1);
        
        row1.addComponents(prevButton, nextButton);
        components.push(row1);
        
        if (totalPages > 3) {
          const pageSelect = new StringSelectMenuBuilder()
            .setCustomId(`birthday_list_jump_${guildId}`)
            .setPlaceholder(`Jump to page... (${currentPage + 1}/${totalPages})`)
            .addOptions(
              Array.from({ length: Math.min(totalPages, 25) }, (_, i) => ({
                label: `Page ${i + 1}`,
                value: String(i),
                description: `Show birthdays ${i * ITEMS_PER_PAGE + 1}-${Math.min((i + 1) * ITEMS_PER_PAGE, sortedBirthdays.length)}`,
                default: i === currentPage
              }))
            );
          
          const row2 = new ActionRowBuilder().addComponents(pageSelect);
          components.push(row2);
        }
      }

      const replyMethod = interaction.replied || interaction.deferred ? 'editReply' : 'reply';
      const message = await interaction[replyMethod]({
        embeds: [embed],
        components: components
      });
      
      if (components.length > 0 && message) {
        setTimeout(async () => {
          try {
            const fetchedMsg = await interaction.channel.messages.fetch(message.id).catch(() => null);
            if (fetchedMsg && fetchedMsg.components.length > 0) {
              await fetchedMsg.edit({ components: [] }).catch(() => {});
            }
          } catch (error) {}
        }, 5 * 60 * 1000);
      }
    }
  } catch (error) {
    console.error('Error in listBirthdays:', error);
    await sendError(interaction, 'Failed to list birthdays.');
  }
}

// Handler for previous page button
export async function handleBirthdayListPrev(interaction) {
  try {
    const parts = interaction.customId.split('_');
    const currentPage = parseInt(parts[3]);
    const newPage = Math.max(0, currentPage - 1);
    
    await interaction.deferUpdate();
    await listBirthdays(interaction, newPage);
  } catch (error) {
    console.error('Error in handleBirthdayListPrev:', error);
  }
}

// Handler for next page button
export async function handleBirthdayListNext(interaction) {
  try {
    const parts = interaction.customId.split('_');
    const currentPage = parseInt(parts[3]);
    const newPage = currentPage + 1;
    
    await interaction.deferUpdate();
    await listBirthdays(interaction, newPage);
  } catch (error) {
    console.error('Error in handleBirthdayListNext:', error);
  }
}

// Handler for page jump dropdown
export async function handleBirthdayListJump(interaction) {
  try {
    const targetPage = parseInt(interaction.values[0]);
    
    await interaction.deferUpdate();
    await listBirthdays(interaction, targetPage);
  } catch (error) {
    console.error('Error in handleBirthdayListJump:', error);
  }
}

function getMonthName(monthNum) {
  if (!monthNum) return 'Unknown Month';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const idx = parseInt(monthNum) - 1;
  return months[idx] || 'Unknown Month';
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

export function scheduleBirthdayChecks(client) {
  const checkBirthdays = async () => {
    if (!state.birthdays) return;
    
    for (const [key, data] of Object.entries(state.birthdays)) {
      const userId = key.split('_')[0];
      
      const userNow = getUserTime(userId);
      const currentYear = userNow.getFullYear();
      
      const month = String(userNow.getMonth() + 1).padStart(2, '0');
      const day = String(userNow.getDate()).padStart(2, '0');
      
      if (data.month === month && data.day === day) {
        if (data.year !== currentYear) {
          // Rate limit: Wait 2 seconds between wishes
          await new Promise(resolve => setTimeout(resolve, BIRTHDAY_WISH_DELAY_MS));
          
          await sendBirthdayWish(client, userId, data);
          
          state.birthdays[key].year = currentYear;
          await db.saveBirthday(key, state.birthdays[key]);
          await saveStateToFile();
        }
      }
    }
  };
  
  setInterval(checkBirthdays, 60 * 60 * 1000);
  setTimeout(checkBirthdays, 5000);
}

async function sendBirthdayWish(client, userId, data) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;
  
  const personName = data.nameType === 'self' ? user.username : 'someone special';
  
  try {
    const request = {
      model: BIRTHDAY_MODEL,
      contents: [{ role: 'user', parts: [{ text: `Write a birthday wish for ${personName}` }] }],
      systemInstruction: { parts: [{ text: 'Generate a short, warm, and personalized birthday wish (2-3 sentences). Be genuine and heartfelt. Include emojis.' }] },
      generationConfig: {
        temperature: 0.9
      }
    };
    
    const result = await genAI.models.generateContent(request);
    const wishMessage = result.text || `Happy Birthday, ${personName}! 🎂🎉 Wishing you an amazing day filled with joy!`;
    
    const embed = new EmbedBuilder()
      .setColor(0xFF69B4)
      .setTitle('🎉 Happy Birthday! 🎂')
      .setDescription(wishMessage)
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: '🎊 Hope your day is as special as you are!' })
      .setTimestamp();
    
    if (data.preference === 'dm' || data.preference === 'both') {
      try {
        await user.send({ embeds: [embed] });
      } catch (error) {
        console.error(`Could not send birthday DM to ${userId}:`, error);
      }
    }
    
    if ((data.preference === 'server' || data.preference === 'both') && data.guildId) {
      try {
        const guild = client.guilds.cache.get(data.guildId);
        if (guild) {
          const channel = guild.channels.cache.find(ch => 
            ch.isTextBased() && 
            ch.permissionsFor(guild.members.me).has('SendMessages')
          );
          
          if (channel) {
            const mention = data.nameType === 'self' ? `<@${userId}>` : user.username;
            await channel.send({
              content: `🎉 Everyone! It's ${mention}'s birthday today! 🎂`,
              embeds: [embed]
            });
          }
        }
      } catch (error) {
        console.error(`Could not send birthday message in server ${data.guildId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in sendBirthdayWish:', error);
  }
        }
