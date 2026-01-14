import { EmbedBuilder, MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType } from 'discord.js';
import { state, saveStateToFile, genAI } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import * as db from '../database.js';
import { getUserTime } from './timezone.js';
import { MODELS, DEFAULT_MODEL } from '../modules/config.js';


const QUOTE_MODEL = MODELS['gemini-2.5-flash-lite'];
const FALLBACK_MODEL = DEFAULT_MODEL;

const MAX_QUOTES_PER_DAY = 5;
const MAX_SCHEDULED_QUOTES_PER_USER = 2;

export const quoteCommand = {
  name: 'quote',
  description: 'Daily inspirational quotes (5 instant/day, 2 scheduled max)'
};

export async function handleQuoteCommand(interaction) {
  const userId = interaction.user.id;
  
  if (!state.quoteUsage) {
    state.quoteUsage = {};
  }
  
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  if (!state.quoteUsage[userId]) {
    state.quoteUsage[userId] = {
      count: 0,
      lastReset: now
    };
  }
  
  const usage = state.quoteUsage[userId];
  
  if (now - usage.lastReset > ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }
  
  const remainingQuotes = MAX_QUOTES_PER_DAY - usage.count;
  
  const scheduledQuotes = Object.values(state.dailyQuotes || {}).filter(q => 
    q && typeof q === 'object' && Object.keys(state.dailyQuotes).some(key => key === userId || key.startsWith(userId + '_'))
  ).length;
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('✨ Daily Quote Setup')
    .setDescription(`What would you like to do?\n\n**Instant Quotes:** ${usage.count}/${MAX_QUOTES_PER_DAY} used today\n**Scheduled Quotes:** ${scheduledQuotes}/${MAX_SCHEDULED_QUOTES_PER_USER} active\n**Resets:** ${new Date(usage.lastReset + ONE_DAY).toLocaleString()}`);

  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId('quote_action')
    .setPlaceholder('Choose an action')
    .addOptions(
      { label: 'Get Quote Now', value: 'now', description: `Instant quote (${remainingQuotes} left)`, emoji: '💭' },
      { label: 'Set Daily Quote', value: 'setup', description: `Schedule automatic quotes (${scheduledQuotes}/${MAX_SCHEDULED_QUOTES_PER_USER})`, emoji: '⏰' },
      { label: 'View Scheduled Quotes', value: 'view', description: 'See your scheduled quotes', emoji: '📋' },
      { label: 'Remove Daily Quote', value: 'remove', description: 'Stop a scheduled quote', emoji: '🗑️' }
    );

  const row = new ActionRowBuilder().addComponents(actionSelect);

  // Requirement: Ephemeral Menu
  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral
  });

  // Requirement: Auto-delete after 3 minutes if unused
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, 3 * 60 * 1000);
}

export async function handleQuoteActionSelect(interaction) {
  const action = interaction.values[0];
  
  if (action === 'now') {
    await sendQuoteNow(interaction);
  } else if (action === 'setup') {
    await showQuoteSetup(interaction);
  } else if (action === 'view') {
    await viewScheduledQuotes(interaction);
  } else if (action === 'remove') {
    await removeQuoteSetup(interaction);
  }
}

async function sendQuoteNow(interaction) {
  // Acknowledge the interaction first to prevent timeout
  await interaction.deferUpdate();
  // Requirement: Delete the menu immediately upon click
  await interaction.deleteReply().catch(() => {});

  const userId = interaction.user.id;
  
  if (!state.quoteUsage) {
    state.quoteUsage = {};
  }
  
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  if (!state.quoteUsage[userId]) {
    state.quoteUsage[userId] = {
      count: 0,
      lastReset: now
    };
  }
  
  const usage = state.quoteUsage[userId];
  
  if (now - usage.lastReset > ONE_DAY) {
    usage.count = 0;
    usage.lastReset = now;
  }
  
  if (usage.count >= MAX_QUOTES_PER_DAY) {
    const timeUntilReset = usage.lastReset + ONE_DAY - now;
    const hoursLeft = Math.ceil(timeUntilReset / (60 * 60 * 1000));
    
    // Since we deleted the ephemeral message, we can't reply to it.
    // We shouldn't send a public error message for a limit reached, so we might just return or send a DM if possible.
    // However, silently failing is bad UX. Sending a DM is a safe fallback.
    try {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Daily Limit Reached')
        .setDescription(`You've used all ${MAX_QUOTES_PER_DAY} instant quotes for today.\n\n**Resets in:** ${hoursLeft} hour${hoursLeft > 1 ? 's' : ''}\n\n*Scheduled quotes don't count toward this limit.*`);
      
      await interaction.user.send({ embeds: [errorEmbed] });
    } catch (e) {
      console.error('Could not send limit reached DM', e);
    }
    return;
  }

  const quote = await generateQuote('inspirational');
  
  usage.count++;
  await saveStateToFile();
  
  const remainingQuotes = MAX_QUOTES_PER_DAY - usage.count;
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('💭 Quote of the Moment')
    .setDescription(quote)
    .setFooter({ text: `Requested by ${interaction.user.displayName} • ${remainingQuotes} left today` })
    .setTimestamp();

  // Requirement: Send as Normal (Public) message to the channel
  try {
    await interaction.channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error('Error sending public quote:', error);
  }
}

async function showQuoteSetup(interaction) {
  const userId = interaction.user.id;
  
  if (!state.dailyQuotes) {
    state.dailyQuotes = {};
  }
  
  const scheduledCount = Object.keys(state.dailyQuotes).filter(key => 
    key === userId || key.startsWith(userId + '_')
  ).length;
  
  if (scheduledCount >= MAX_SCHEDULED_QUOTES_PER_USER) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Scheduled Quote Limit')
      .setDescription(`You have reached the maximum of ${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes.\n\nPlease remove one before adding another using \`/quote action:remove\``)
      .setFooter({ text: `${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes active` });
    
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('✨ Daily Quote Setup - Category')
    .setDescription(`What type of quotes do you prefer?\n\n**Active Scheduled Quotes:** ${scheduledCount}/${MAX_SCHEDULED_QUOTES_PER_USER}`)
    .setFooter({ text: 'Scheduled quotes don\'t count toward your 5/day instant quote limit' });

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId('quote_category')
    .setPlaceholder('Select quote category')
    .addOptions(
      { label: 'Inspirational', value: 'inspirational', description: 'Motivational and uplifting', emoji: '🌟' },
      { label: 'Funny', value: 'funny', description: 'Humor and wit', emoji: '😂' },
      { label: 'Wisdom', value: 'wisdom', description: 'Philosophical and thoughtful', emoji: '🧠' },
      { label: 'Love', value: 'love', description: 'Romance and relationships', emoji: '💖' },
      { label: 'Success', value: 'success', description: 'Achievement and growth', emoji: '🎯' }
    );

  const row = new ActionRowBuilder().addComponents(categorySelect);

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

export async function handleQuoteCategorySelect(interaction) {
  const category = interaction.values[0];
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('✨ Daily Quote Setup - Time')
    .setDescription(`Category: **${category}**\n\nWhat time should I send your daily quote? (24h format)`)
    .setFooter({ text: 'Times are in your local timezone if set via /timezone' });

  const timeSelect = new StringSelectMenuBuilder()
    .setCustomId(`quote_time_${category}`)
    .setPlaceholder('Select time')
    .addOptions(
      { label: '06:00 (Morning)', value: '06:00', emoji: '🌅' },
      { label: '09:00 (Start of day)', value: '09:00', emoji: '☕' },
      { label: '12:00 (Noon)', value: '12:00', emoji: '🌞' },
      { label: '18:00 (Evening)', value: '18:00', emoji: '🌆' },
      { label: '21:00 (Night)', value: '21:00', emoji: '🌙' }
    );

  const row = new ActionRowBuilder().addComponents(timeSelect);

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

export async function handleQuoteTimeSelect(interaction) {
  const [_, __, category] = interaction.customId.split('_');
  const time = interaction.values[0];
  
  const guildId = interaction.guild?.id;
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('✨ Daily Quote Setup - Location')
    .setDescription(`Category: **${category}**\nTime: **${time}**\n\nWhere should I send your daily quote?`);

  const locationSelect = new StringSelectMenuBuilder()
    .setCustomId(`quote_location_${category}_${time.replace(':', '-')}`);
  
  if (guildId) {
    locationSelect.setPlaceholder('Choose delivery location')
      .addOptions(
        { label: 'DM Only', value: 'dm', description: 'Receive in direct messages', emoji: '📬' },
        { label: 'Server Channel', value: 'server', description: 'Post in a specific channel', emoji: '💬' }
      );
  } else {
    locationSelect.setPlaceholder('Choose delivery location')
      .addOptions(
        { label: 'DM', value: 'dm', description: 'Receive in direct messages', emoji: '📬' }
      );
  }

  const row = new ActionRowBuilder().addComponents(locationSelect);

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

export async function handleQuoteLocationSelect(interaction) {
  const [_, __, category, timeStr] = interaction.customId.split('_');
  const time = timeStr.replace('-', ':');
  const location = interaction.values[0];
  
  if (location === 'server' && interaction.guild) {
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('✨ Daily Quote Setup - Channel')
      .setDescription('Select the channel where quotes should be posted:');

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`quote_channel_${category}_${timeStr}`)
      .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
      .setPlaceholder('Select a channel');

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } else {
    await finalizeQuoteSetup(interaction, category, time, 'dm', null);
  }
}

export async function handleQuoteChannelSelect(interaction) {
  const [_, __, category, timeStr] = interaction.customId.split('_');
  const time = timeStr.replace('-', ':');
  const channelId = interaction.values[0];
  
  await finalizeQuoteSetup(interaction, category, time, 'server', channelId);
}

async function finalizeQuoteSetup(interaction, category, time, location, channelId) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;
  
  if (!state.dailyQuotes) {
    state.dailyQuotes = {};
  }
  
  const scheduledCount = Object.keys(state.dailyQuotes).filter(key => 
    key === userId || key.startsWith(userId + '_')
  ).length;
  
  if (scheduledCount >= MAX_SCHEDULED_QUOTES_PER_USER) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Scheduled Quote Limit')
      .setDescription(`You have reached the maximum of ${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes.`);
    
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }
  
  const [hour, minute] = time.split(':').map(Number);
  
  const quoteKey = scheduledCount === 0 ? userId : `${userId}_${scheduledCount + 1}`;
  
  state.dailyQuotes[quoteKey] = {
    category,
    hour,
    minute,
    location,
    channelId,
    guildId,
    active: true
  };
  
  await db.saveDailyQuote(quoteKey, state.dailyQuotes[quoteKey]);
  await saveStateToFile();
  
  // Invalidate cache since daily quotes are part of personal data
  memorySystem.invalidatePersonalDataCache(userId);
  
  const locationText = location === 'dm' 
    ? 'your DMs' 
    : `<#${channelId}>`;
  
  const newCount = scheduledCount + 1;
  
  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Daily Quote Activated!')
    .setDescription(`**Category:** ${category}\n**Time:** ${time}\n**Location:** ${locationText}\n\nYou'll receive a quote every day at this time! ✨\n\n*Scheduled quotes don't count toward your 5/day instant quote limit.*`)
    .setFooter({ text: `${newCount}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes active • Use /quote remove to manage` });

  await interaction.update({
    embeds: [embed],
    components: []
  });
  
  scheduleDailyQuote(interaction.client, quoteKey, state.dailyQuotes[quoteKey]);
}

async function viewScheduledQuotes(interaction) {
  const userId = interaction.user.id;
  
  if (!state.dailyQuotes) {
    state.dailyQuotes = {};
  }
  
  const userQuotes = Object.entries(state.dailyQuotes).filter(([key, data]) => 
    key === userId || key.startsWith(userId + '_')
  );
  
  if (userQuotes.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('📋 No Scheduled Quotes')
      .setDescription('You don\'t have any scheduled quotes set up.\n\nUse `/quote action:setup` to create one!');
    
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }
  
  const quoteList = userQuotes.map(([key, data], index) => {
    const time = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}`;
    const location = data.location === 'dm' ? 'DMs' : `<#${data.channelId}>`;
    return `**${index + 1}.** ${data.category} quote at ${time} → ${location}`;
  }).join('\n');
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('📋 Your Scheduled Quotes')
    .setDescription(quoteList)
    .setFooter({ text: `${userQuotes.length}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes • These don't count toward your 5/day limit` });

  await interaction.update({
    embeds: [embed],
    components: []
  });
}

async function removeQuoteSetup(interaction) {
  const userId = interaction.user.id;
  
  if (!state.dailyQuotes) {
    state.dailyQuotes = {};
  }
  
  const userQuotes = Object.entries(state.dailyQuotes).filter(([key, data]) => 
    key === userId || key.startsWith(userId + '_')
  );
  
  if (userQuotes.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ No Scheduled Quotes')
      .setDescription('You don\'t have any scheduled quotes to remove.\n\nUse `/quote action:setup` to create one!');
    
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }
  
  const embed = new EmbedBuilder()
    .setColor(0xFF6B6B)
    .setTitle('🗑️ Remove Scheduled Quote')
    .setDescription('Select which scheduled quote to remove:');

  const removeSelect = new StringSelectMenuBuilder()
    .setCustomId('quote_remove_select')
    .setPlaceholder('Choose quote to remove')
    .addOptions(
      userQuotes.map(([key, data], index) => {
        const time = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}`;
        const location = data.location === 'dm' ? 'DMs' : 'Server';
        return {
          label: `${index + 1}. ${data.category} at ${time}`,
          description: `Sent to ${location}`,
          value: key
        };
      })
    );

  const row = new ActionRowBuilder().addComponents(removeSelect);

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

export async function handleQuoteRemoveSelect(interaction) {
  const quoteKey = interaction.values[0];
  
  if (!state.dailyQuotes?.[quoteKey]) {
    const embed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Quote Not Found')
      .setDescription('Could not find that scheduled quote.');
    
    return interaction.update({
      embeds: [embed],
      components: []
    });
  }
  
  const quote = state.dailyQuotes[quoteKey];
  delete state.dailyQuotes[quoteKey];
  await db.deleteDailyQuote(quoteKey);
  await saveStateToFile();
  
  memorySystem.invalidatePersonalDataCache(interaction.user.id);
  
  const userId = interaction.user.id;
  const remaining = Object.keys(state.dailyQuotes).filter(key => 
    key === userId || key.startsWith(userId + '_')
  ).length;
  
  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('✅ Scheduled Quote Removed')
    .setDescription(`Removed ${quote.category} quote at ${String(quote.hour).padStart(2, '0')}:${String(quote.minute).padStart(2, '0')}`)
    .setFooter({ text: `${remaining}/${MAX_SCHEDULED_QUOTES_PER_USER} scheduled quotes remaining` });

  await interaction.update({
    embeds: [embed],
    components: []
  });
}

async function generateQuote(category) {
  try {
    const request = {
      model: QUOTE_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `Generate one ${category} quote with author attribution.`
        }]
      }],
      systemInstruction: {
        parts: [{
          text: `Generate a single ${category} quote. Format: "Quote text" - Author\n\nRules:\n- Keep quotes concise (1-2 sentences)\n- Include author name\n- Match the ${category} theme perfectly\n- Be inspiring and meaningful`
        }]
      },
      generationConfig: {
        temperature: 0.9
      }
    };
    
    const result = await genAI.models.generateContent(request);
    return result.text || '"The only way to do great work is to love what you do." - Steve Jobs';
  } catch (error) {
    console.error('Error with flash-lite, trying fallback:', error);
    
    try {
      const request = {
        model: FALLBACK_MODEL,
        contents: [{
          role: 'user',
          parts: [{
            text: `Generate one ${category} quote with author attribution.`
          }]
        }],
        systemInstruction: {
          parts: [{
            text: `Generate a single ${category} quote. Format: "Quote text" - Author\n\nRules:\n- Keep quotes concise (1-2 sentences)\n- Include author name\n- Match the ${category} theme perfectly\n- Be inspiring and meaningful`
          }]
        },
        generationConfig: {
          temperature: 0.9
        }
      };
      
      const result = await genAI.models.generateContent(request);
      return result.text || '"The only way to do great work is to love what you do." - Steve Jobs';
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError);
      return '"The only way to do great work is to love what you do." - Steve Jobs';
    }
  }
}

export function scheduleDailyQuote(client, quoteKey, config) {
  const userId = quoteKey.split('_')[0];
  
  const checkAndSend = async () => {
    const userNow = getUserTime(userId);
    
    if (userNow.getHours() === config.hour && userNow.getMinutes() === config.minute) {
      await sendDailyQuote(client, quoteKey, config);
    }
  };
  
  const intervalId = setInterval(checkAndSend, 60 * 1000);
  
  if (!client.quoteIntervals) {
    client.quoteIntervals = new Map();
  }
  client.quoteIntervals.set(quoteKey, intervalId);
}

async function sendDailyQuote(client, quoteKey, config) {
  const quote = await generateQuote(config.category);
  
  const userId = quoteKey.split('_')[0];
  
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`✨ Your Daily ${config.category.charAt(0).toUpperCase() + config.category.slice(1)} Quote`)
    .setDescription(quote)
    .setFooter({ text: 'Scheduled quote • Doesn\'t count toward your 5/day limit' })
    .setTimestamp();
  
  if (config.location === 'dm') {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Could not send daily quote to ${userId}:`, error);
    }
  } else if (config.location === 'server' && config.channelId) {
    try {
      const channel = client.channels.cache.get(config.channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Could not send daily quote to channel ${config.channelId}:`, error);
    }
  }
}

export function initializeDailyQuotes(client) {
  if (!state.dailyQuotes) return;
  
  for (const quoteKey in state.dailyQuotes) {
    if (state.dailyQuotes[quoteKey].active) {
      scheduleDailyQuote(client, quoteKey, state.dailyQuotes[quoteKey]);
    }
  }
}
