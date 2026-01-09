import { EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, ChannelType } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { getTextExtractor } from 'office-text-extractor';
import ffmpeg from 'fluent-ffmpeg';
import { delay } from '../tools/others.js';
import { genAI, state, chatHistoryLock, updateChatHistory, saveStateToFile, TEMP_DIR, client } from '../botManager.js';
import { memorySystem } from '../memorySystem.js';
import config from '../config.js';
import * as db from '../database.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, MODEL_FALLBACK_CHAIN, DEFAULT_MODEL } from './config.js';
import { updateEmbed, sendAsTextFile } from './responseHandler.js';

/**
* Removes file references from history to prevent 403 errors after key rotation.
* This is now only called when a PERMISSION_DENIED error is triggered by rotation.
*/
function cleanHistoryFiles(history) {
 return history.map(entry => ({
   role: entry.role,
   parts: entry.parts.map(part => {
     if (part.fileUri || part.fileData) {
       return {
         text: '[Previous file attachment - content no longer available]'
       };
     }
     return part;
   }).filter(part => part.text)
 })).filter(entry => entry.parts.length > 0);
}

/**
* Centralized typing indicator manager to prevent dangling indicators
*/
class TypingManager {
 constructor() {
   this.activeIntervals = new Map(); // channelId -> intervalId
 }

 start(channel) {
   if (!channel || this.activeIntervals.has(channel.id)) {
     return; // Already typing in this channel
   }

   // Initial typing
   channel.sendTyping().catch(() => {});
   
   // Set up interval
   const intervalId = setInterval(() => {
     channel.sendTyping().catch(() => {});
   }, 4000);
   
   this.activeIntervals.set(channel.id, intervalId);
   
   // Auto-cleanup after 2 minutes as failsafe
   setTimeout(() => {
     this.stop(channel.id);
   }, 120000);
 }

 stop(channelId) {
   const intervalId = this.activeIntervals.get(channelId);
   if (intervalId) {
     clearInterval(intervalId);
     this.activeIntervals.delete(channelId);
   }
 }

 stopAll() {
   for (const [channelId, intervalId] of this.activeIntervals.entries()) {
     clearInterval(intervalId);
   }
   this.activeIntervals.clear();
 }
}

const typingManager = new TypingManager();

export async function processUserQueue(userId) {
 const userQueueData = state.requestQueues.get(userId);
 if (!userQueueData) return;

 // Guard against double-starts with atomic flag check
 if (userQueueData.isProcessing) {
   console.log(`⚠️ Queue for ${userId} is already processing, skipping duplicate call`);
   return;
 }

 userQueueData.isProcessing = true;

 while (userQueueData.queue.length > 0) {
   const currentItem = userQueueData.queue[0];

   try {
     if (currentItem.isChatInputCommand && currentItem.isChatInputCommand()) {
       const { executeSearchInteraction } = await import('./searchCommand.js');
       await executeSearchInteraction(currentItem);
     } else {
       await handleTextMessage(currentItem);
     }
   } catch (error) {
     console.error(`Error processing queued item for ${userId}:`, error);
     // Ensure typing indicator stops even on error
     if (currentItem.channel) {
       typingManager.stop(currentItem.channel.id);
     }
   } finally {
     userQueueData.queue.shift();
   }
 }

 userQueueData.isProcessing = false;
 state.requestQueues.delete(userId);
}

async function handleTextMessage(message) {
 const botId = client.user.id;
 const userId = message.author.id;
 const guildId = message.guild?.id;
 const channelId = message.channel.id;

 // Start typing with centralized manager
 typingManager.start(message.channel);

 try {
   // Update realive tracking
   if (guildId && state.realive && state.realive[guildId]) {
     const realiveConfig = state.realive[guildId];
     if (realiveConfig.enabled && realiveConfig.lastChannelId !== channelId) {
       realiveConfig.lastChannelId = channelId;
       db.saveRealiveConfig(guildId, realiveConfig).catch(e => console.error("Realive update failed", e));
     }
   }

   let messageContent = message.content.replace(new RegExp(`<@!?${botId}>`), '').trim();

   // Handle GIF embed delay
   const gifRegex = /https?:\/\/(?:www\.)?(tenor\.com|giphy\.com)/i;
   if (gifRegex.test(messageContent) && (!message.embeds || message.embeds.length === 0)) {
     await delay(1500);
     try {
       message = await message.channel.messages.fetch(message.id);
       messageContent = message.content.replace(new RegExp(`<@!?${botId}>`), '').trim();
     } catch (e) {}
   }

   let repliedMessageText = '';
   let repliedAttachments = [];

   // Process replied message
   if (message.reference && message.reference.messageId) {
     try {
       const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);

       if (repliedMsg) {
         let contextBuffer = `[Context - Replying to ${repliedMsg.author.username}]:\n`;

         if (repliedMsg.content) {
           contextBuffer += `${repliedMsg.content}\n`;
         }

         if (repliedMsg.embeds.length > 0) {
           repliedMsg.embeds.forEach((embed, index) => {
             contextBuffer += `[Embed ${index + 1} Content]:\n`;
             if (embed.title) contextBuffer += `Title: ${embed.title}\n`;
             if (embed.description) contextBuffer += `Description: ${embed.description}\n`;
             if (embed.fields && embed.fields.length > 0) {
               embed.fields.forEach(field => {
                 contextBuffer += `${field.name}: ${field.value}\n`;
               });
             }
           });
         }

         if (repliedMsg.attachments.size > 0) {
           repliedAttachments = Array.from(repliedMsg.attachments.values());
           contextBuffer += `[Contains ${repliedMsg.attachments.size} attachment(s)]\n`;
         }

         if (repliedMsg.stickers.size > 0) {
           repliedMsg.stickers.forEach(sticker => {
             contextBuffer += `[Sticker: ${sticker.name}]\n`;
           });
         }

         repliedMessageText = contextBuffer + "\n" + "-".repeat(20) + "\n";
       }
     } catch (error) {
       console.error("Error processing reply context:", error);
     }
   }

   if (repliedMessageText) {
     const userText = messageContent ? messageContent : "[No text provided in reply, only attachments/interaction]";
     messageContent = `${repliedMessageText}[User's Response]:\n${userText}`;
   }

   // Extract GIF links
   const gifLinks = [];
   const tenorGiphyRegex = /https?:\/\/(?:www\.)?(tenor\.com\/view\/[^\s]+|giphy\.com\/gifs\/[^\s]+|media\.tenor\.com\/[^\s]+\.gif|media\.giphy\.com\/media\/[^\s]+\/giphy\.gif)/gi;
   let gifMatch;

   while ((gifMatch = tenorGiphyRegex.exec(messageContent)) !== null) {
     gifLinks.push(gifMatch[0]);
   }

   if (message.embeds && message.embeds.length > 0) {
     for (const embed of message.embeds) {
       const isTenor = embed.provider?.name?.toLowerCase() === 'tenor';
       const isGiphy = embed.provider?.name?.toLowerCase() === 'giphy';

       if (isTenor || isGiphy) {
         const mediaUrl = embed.video?.url || embed.video?.proxyURL ||
           embed.image?.url || embed.image?.proxyURL ||
           embed.thumbnail?.url || embed.thumbnail?.proxyURL;

         if (mediaUrl) {
           gifLinks.push(mediaUrl);
           const gifDescription = embed.description || embed.title || embed.url || 'GIF';
           const contextText = `[User sent a ${embed.provider?.name || 'GIF'}${gifDescription !== 'GIF' ? ': ' + gifDescription : ''}]`;
           if (!messageContent.includes(contextText)) {
             messageContent += `\n${contextText}`;
           }
         }
       }
     }
   }

   // Process GIF links as attachments
   const gifLinkAttachments = [];
   for (const gifUrl of gifLinks) {
     try {
       let gifName = 'tenor_gif.gif';
       if (gifUrl.includes('tenor.com')) {
         const nameMatch = gifUrl.match(/\/view\/([^\/\-]+)/);
         gifName = nameMatch ? `${nameMatch[1]}.gif` : 'tenor_gif.gif';
       } else if (gifUrl.includes('giphy.com')) {
         const nameMatch = gifUrl.match(/\/gifs\/([^\/\-]+)/);
         gifName = nameMatch ? `${nameMatch[1]}.gif` : 'giphy_gif.gif';
       }

       let directGifUrl = gifUrl;

       if (gifUrl.includes('media.tenor.com') || gifUrl.includes('media.giphy.com')) {
         directGifUrl = gifUrl;
       } else if (gifUrl.includes('tenor.com/view/')) {
         try {
           if (!gifUrl.endsWith('.gif')) {
             directGifUrl = gifUrl + '.gif';
           }
           const testResponse = await axios.head(directGifUrl, { timeout: 3000 }).catch(() => null);
           if (!testResponse || testResponse.status !== 200) {
             const response = await axios.get(gifUrl, { timeout: 5000 });
             const htmlContent = response.data;
             const mp4Match = htmlContent.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.mp4)"/);
             const gifMatch = htmlContent.match(/"url":"(https:\/\/media\.tenor\.com\/[^"]+\.gif)"/);

             if (mp4Match) {
               directGifUrl = mp4Match[1].replace(/\\u002F/g, '/');
             } else if (gifMatch) {
               directGifUrl = gifMatch[1].replace(/\\u002F/g, '/');
             }
           }
         } catch (error) {
           continue;
         }
       } else if (gifUrl.includes('giphy.com/gifs/')) {
         try {
           const response = await axios.get(gifUrl, { timeout: 5000 });
           const htmlContent = response.data;
           const gifMatch = htmlContent.match(/"url":"(https:\/\/media\.giphy\.com\/media\/[^"]+\/giphy\.gif)"/);
           if (gifMatch) {
             directGifUrl = gifMatch[1];
           } else {
             directGifUrl = gifUrl + (gifUrl.endsWith('.gif') ? '' : '.gif');
           }
         } catch (error) {
           continue;
         }
       }

       gifLinkAttachments.push({
         id: `gif-link-${Date.now()}-${Math.random()}`,
         name: gifName,
         url: directGifUrl,
         contentType: 'image/gif',
         size: 0,
         isGifLink: true
       });

       messageContent = messageContent.replace(gifUrl, '').trim();
     } catch (error) {
       console.error('Error processing GIF link:', error);
     }
   }

   // Extract forwarded content
   const { forwardedText, forwardedAttachments, forwardedStickers } = extractForwardedContent(message);

   if (forwardedText) {
     if (messageContent === '') {
       messageContent = `[Forwarded message]:\n${forwardedText}`;
     } else {
       messageContent = `${messageContent}\n\n[Forwarded message]:\n${forwardedText}`;
     }
   }

   // Process stickers
   const currentStickers = message.stickers ? Array.from(message.stickers.values()) : [];
   const allStickers = [...currentStickers, ...forwardedStickers];

   const stickerAttachments = [];
   for (const sticker of allStickers) {
     const stickerAttachment = await processStickerAsAttachment(sticker);
     if (stickerAttachment) {
       stickerAttachments.push(stickerAttachment);
       const stickerType = stickerAttachment.isAnimated ? 'Animated Sticker' : 'Sticker';
       if (!messageContent.includes(sticker.name)) {
         messageContent += `\n[${stickerType}: ${sticker.name}]`;
       }
     }
   }

   // Process custom emojis
   const customEmojis = extractCustomEmojis(messageContent);
   const limitedEmojis = customEmojis.slice(0, 5);
   const exceededEmojis = customEmojis.slice(5);

   const emojiAttachments = [];
   if (limitedEmojis.length > 0) {
     for (const emoji of limitedEmojis) {
       const emojiAttachment = await processEmojiAsAttachment(emoji);
       if (emojiAttachment) {
         emojiAttachments.push(emojiAttachment);
       }
     }
   }

   if (exceededEmojis.length > 0) {
     for (const emoji of exceededEmojis) {
       messageContent = messageContent.replace(emoji.fullMatch, `:${emoji.name}:`);
     }
   }

   const regularAttachments = Array.from(message.attachments.values());

   const allAttachments = [
     ...repliedAttachments,
     ...regularAttachments,
     ...forwardedAttachments,
     ...stickerAttachments,
     ...emojiAttachments,
     ...gifLinkAttachments
   ];

   // Ignore polls
   if (message.poll || message.type === 46) {
     typingManager.stop(channelId);
     return;
   }

   // Check if message has any content
   const hasAnyContent = messageContent.trim() !== '' ||
     (allAttachments.length > 0 && allAttachments.some(att => {
       const contentType = (att.contentType || "").toLowerCase();
       const fileExtension = path.extname(att.name).toLowerCase();
       const supportedTypes = [
         contentType.startsWith('image/'),
         contentType.startsWith('audio/'),
         contentType.startsWith('video/'),
         contentType.startsWith('application/pdf'),
         ['.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a'].includes(fileExtension),
         ['.mp4', '.mov', '.mpeg', '.mpg', '.webm', '.avi', '.wmv', '.3gpp', '.flv'].includes(fileExtension),
         ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp'].includes(fileExtension),
         ['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.tsv', '.pptx', '.rtf', '.html', '.py', '.java', '.js', '.css', '.json', '.xml', '.sql', '.log', '.md'].includes(fileExtension)
       ];
       return supportedTypes.some(t => t);
     }));

   if (!hasAnyContent) {
     typingManager.stop(channelId);
     const embed = new EmbedBuilder()
       .setColor(0x5865F2)
       .setTitle('💬 Empty Message')
       .setDescription("You didn't provide any content. What would you like to talk about?");
     await message.reply({ embeds: [embed] });
     return;
   }

   let botMessage = null;
   let parts;
   let hasMedia = false;
   let finalPromptForHistory = messageContent;

   try {
     // PARALLEL: Extract file text + process attachments
     const [fileExtractResult, initialParts] = await Promise.all([
       extractFileText(message, messageContent),
       processPromptAndMediaAttachments(messageContent, message, allAttachments)
     ]);

     const { finalPrompt, summaryParts } = fileExtractResult;
     finalPromptForHistory = finalPrompt;
     parts = initialParts;
     
     if (summaryParts && summaryParts.length > 0) {
       parts.push(...summaryParts);
     }
     
     hasMedia = parts.some(part => part.fileUri || part.fileData || part.inlineData);
   } catch (error) {
     console.error('Error initializing message:', error);
     typingManager.stop(channelId);
     return;
   }

   // Get settings
   const userSettings = state.userSettings[userId] || {};
   const serverSettings = guildId ? (state.serverSettings[guildId] || {}) : {};
   const effectiveSettings = serverSettings.overrideUserSettings ? serverSettings : userSettings;

   // Build instructions
   let finalInstructions = config.coreSystemRules;

   let customInstructions;
   if (guildId) {
     if (state.channelWideChatHistory[channelId]) {
       customInstructions = state.customInstructions[channelId];
     } else if (serverSettings.customPersonality) {
       customInstructions = serverSettings.customPersonality;
     } else if (effectiveSettings.customPersonality) {
       customInstructions = effectiveSettings.customPersonality;
     } else {
       customInstructions = state.customInstructions[userId];
     }
   } else {
     customInstructions = effectiveSettings.customPersonality || state.customInstructions[userId];
   }

   if (customInstructions) {
     finalInstructions += `\n\nADDITIONAL PERSONALITY:\n${customInstructions}`;
   } else {
     finalInstructions += `\n\n${config.defaultPersonality}`;
   }

   // Add user info
   let infoStr = '';
   if (guildId) {
     const userInfo = {
       username: message.author.username,
       displayName: message.author.displayName
     };
     infoStr = `\nYou are currently engaging with users in the ${message.guild.name} Discord server.\n\n## Current User Information\nUsername: \`${userInfo.username}\`\nDisplay Name: \`${userInfo.displayName}\``;
   } else {
     const userInfo = {
       username: message.author.username,
       displayName: message.author.displayName
     };
     infoStr = `\n## Current User Information\nUsername: \`${userInfo.username}\`\nDisplay Name: \`${userInfo.displayName}\``;
   }

   finalInstructions += infoStr;

   // Determine history ID
   const isServerChatHistoryEnabled = guildId ? serverSettings.serverChatHistory : false;
   const isChannelChatHistoryEnabled = guildId ? state.channelWideChatHistory[channelId] : false;
   const historyId = isServerChatHistoryEnabled ? guildId : (isChannelChatHistoryEnabled ? channelId : userId);

   const selectedModel = effectiveSettings.selectedModel || DEFAULT_MODEL;
   const modelName = MODELS[selectedModel];

   // Build tools array - EACH TOOL TYPE MUST BE A SEPARATE OBJECT IN THE ARRAY
// This is the correct format according to Gemini API documentation
// See: https://ai.google.dev/gemini-api/docs/function-calling

const allTools = [];
allTools.push({ googleSearch: {} });
allTools.push({ urlContext: {} });
if (!hasMedia) {
  allTools.push({ codeExecution: {} });
}
// Custom functionDeclarations removed - cannot mix with built-in tools

// Result will be an array like:
// [
//   { googleSearch: {} },
//   { urlContext: {} },
//   { codeExecution: {} },  // optional
//   { functionDeclarations: [...] }  // optional
// ]
   // PARALLEL: Get optimized history with RAG (includes personal data + cross-RAG)
   const history = await memorySystem.getOptimizedHistory(
     historyId,
     finalPromptForHistory,
     modelName,
     userId,  // For personal data RAG
     guildId  // For cross-RAG
   );

   await handleModelResponse(
     botMessage,
     modelName,
     finalInstructions,
     null,
     safetySettings,
     allTools, // Use combined tools
     history,
     parts,
     message,
     channelId,
     historyId,
     effectiveSettings,
     finalPromptForHistory,
     allAttachments
   );
   
 } catch (error) {
   console.error('Unhandled error in handleTextMessage:', error);
   typingManager.stop(channelId);
   
   try {
     const embed = new EmbedBuilder()
       .setColor(0xFF0000)
       .setTitle('❌ Unexpected Error')
       .setDescription('An unexpected error occurred while processing your message. Please try again.');
     await message.reply({ embeds: [embed] });
   } catch (replyError) {
     console.error('Failed to send error message:', replyError);
   }
 }
}

function extractCustomEmojis(content) {
 const emojiRegex = /<a?:(\w+):(\d+)>/g;
 const emojis = [];
 let match;

 while ((match = emojiRegex.exec(content)) !== null) {
   const animated = match[0].startsWith('<a:');
   emojis.push({
     name: match[1],
     id: match[2],
     animated: animated,
     fullMatch: match[0]
   });
 }

 return emojis;
}

async function processStickerAsAttachment(sticker) {
 try {
   const isAnimated = sticker.format === 2 || sticker.format === 3 || sticker.format === 4;
   let contentType = 'image/png';
   let fileExtension = '.png';
   let url = sticker.url;

   if (sticker.format === 2) {
     contentType = 'image/png';
     fileExtension = '.png';
   } else if (sticker.format === 3) {
     contentType = 'application/json';
     fileExtension = '.json';
   } else if (sticker.format === 4) {
     contentType = 'image/gif';
     fileExtension = '.gif';
     url = `https://media.discordapp.net/stickers/${sticker.id}.gif`;
   }
   
   const name = sticker.name.endsWith(fileExtension) ? sticker.name : `${sticker.name}${fileExtension}`;

   return {
     name: name,
     url: url,
     contentType: contentType,
     isAnimated: isAnimated,
     isSticker: true
   };
 } catch (error) {
   console.error('Error processing sticker:', error);
   return null;
 }
}

async function processEmojiAsAttachment(emoji) {
 try {
   const extension = emoji.animated ? 'gif' : 'png';
   const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}`;
   
   return {
     name: `${emoji.name}.${extension}`,
     url: url,
     contentType: emoji.animated ? 'image/gif' : 'image/png',
     isAnimated: emoji.animated,
     isEmoji: true,
     emojiName: emoji.name
   };
 } catch (error) {
   console.error('Error processing emoji:', error);
   return null;
 }
}

function extractForwardedContent(message) {
 let forwardedText = '';
 let forwardedAttachments = [];
 let forwardedStickers = [];

 if (message.messageSnapshots && message.messageSnapshots.size > 0) {
   const snapshot = message.messageSnapshots.first();
   
   if (snapshot.content) {
     forwardedText = snapshot.content;
   }
   
   if (snapshot.embeds && snapshot.embeds.length > 0) {
     const embedTexts = snapshot.embeds
       .map(embed => {
         let text = '';
         if (embed.title) text += `**${embed.title}**\n`;
         if (embed.description) text += embed.description;
         return text;
       })
       .filter(t => t)
       .join('\n\n');
     
     if (embedTexts) {
       forwardedText += '\n\n' + embedTexts;
     }
   }
   
   if (snapshot.attachments && snapshot.attachments.size > 0) {
     forwardedAttachments = Array.from(snapshot.attachments.values());
   }
   
   if (snapshot.stickers && snapshot.stickers.size > 0) {
     forwardedStickers = Array.from(snapshot.stickers.values());
   }
 }

 return { forwardedText, forwardedAttachments, forwardedStickers };
}

async function extractFileText(message, messageContent) {
 let finalPrompt = messageContent;
 let summaryParts = [];

 // Check for Discord message links
 const discordLinkRegex = /https?:\/\/(?:www\.)?discord\.com\/channels\/\d+\/\d+\/\d+/g;
 const messageLinks = finalPrompt.match(discordLinkRegex);

 if (messageLinks && messageLinks.length > 0) {
   const patterns = [
     /(?:summarize|summarise|summary).*?(?:around|next|following|from)\s+(\d+)\s+messages?/i,
     /(?:around|next|following|from)\s+(\d+)\s+messages?/i,
     /(\d+)\s+messages?.*?(?:around|after|from)/i,
     /(?:get|fetch|show|read)\s+(\d+)\s+messages?/i
   ];
   
   let messageCount = 1;
   let requestedCount = 1;
   
   for (const pattern of patterns) {
     const match = finalPrompt.match(pattern);
     if (match && match[1]) {
       requestedCount = parseInt(match[1]);
       messageCount = Math.min(requestedCount, 100);
       break;
     }
   }
   
   if (messageCount === 1 && /messages/i.test(finalPrompt) && !/\b1\s+message/i.test(finalPrompt)) {
     messageCount = 10;
     requestedCount = 10;
   }
   
   if (requestedCount > 100) {
     try {
       const warningEmbed = new EmbedBuilder()
         .setColor(0xFFAA00)
         .setTitle('⚠️ Message Limit Exceeded')
         .setDescription(`You requested ${requestedCount} messages, but the maximum limit is 100 messages.\n\nI will summarize the available messages around the linked message.`);
       
       await message.reply({ embeds: [warningEmbed] });
     } catch (error) {
       console.error('Error sending limit warning:', error);
     }
   }
   
   const { fetchMessagesForSummary } = await import('./utils.js');
   const result = await fetchMessagesForSummary(message, messageLinks[0], messageCount);
   
   if (result.error) {
     finalPrompt += `\n\n[Error: ${result.error}]`;
   } else if (result.success) {
     try {
       const fileName = `discord_summary_${Date.now()}.txt`;
       const filePath = path.join(TEMP_DIR, fileName);
       const fileContent = `Discord Messages Summary Context\nChannel: #${result.channelName}\nServer: ${result.guildName}\nMessages Fetched: ${result.messageCount}\n\n${result.content}`;
       
       await fs.writeFile(filePath, fileContent);
       
       const uploadResult = await genAI.files.upload({
         file: filePath,
         config: {
           mimeType: 'text/plain',
           displayName: 'Discord Summary Data'
         }
       });

       await fs.unlink(filePath).catch(() => {});

       summaryParts.push({
         text: `[Context: Attached file contains ${result.messageCount} Discord messages to summarize from #${result.channelName} in ${result.guildName}]`
       });
       summaryParts.push({
         fileData: {
           fileUri: uploadResult.uri,
           mimeType: uploadResult.mimeType
         }
       });

       finalPrompt = finalPrompt.replace(messageLinks[0], `[Link Processed: ${messageLinks[0]}]`);
     } catch (fileError) {
       console.error('Failed to create summary file:', fileError);
       finalPrompt += `\n\n[Discord Messages to Summarize]:\n${result.content}`;
     }
   }
 }

 // Process text files from current message
 if (message.attachments.size > 0) {
   let attachments = Array.from(message.attachments.values());
   finalPrompt = await processTextFiles(attachments, finalPrompt, '');
 }

 // Process text files from forwarded message
 if (message.messageSnapshots && message.messageSnapshots.size > 0) {
   const snapshot = message.messageSnapshots.first();
   if (snapshot.attachments && snapshot.attachments.size > 0) {
     let forwardedAttachments = Array.from(snapshot.attachments.values());
     finalPrompt = await processTextFiles(forwardedAttachments, finalPrompt, '[Forwarded] ');
   }
 }

 return { finalPrompt, summaryParts };
}

async function processTextFiles(attachments, messageContent, prefix = '') {
 for (const attachment of attachments) {
   const fileType = path.extname(attachment.name).toLowerCase();
   const textFileTypes = ['.html', '.js', '.css', '.json', '.xml', '.csv', '.py', '.java', '.sql', '.log', '.md', '.txt', '.rtf'];

   if (textFileTypes.includes(fileType)) {
     try {
       let fileContent = await downloadAndReadFile(attachment.url, fileType);

       if (fileContent.length <= 1000000) {
         messageContent += `\n\n${prefix}[\`${attachment.name}\` File Content]:\n\`\`\`\n${fileContent.slice(0, 50000)}\n\`\`\``;
       }
     } catch (error) {
       console.error(`Error reading file ${attachment.name}: ${error.message}`);
     }
   }
 }
 return messageContent;
}

async function downloadAndReadFile(url, fileType) {
 switch (fileType) {
   case '.pptx':
   case '.docx':
     const extractor = getTextExtractor();
     return (await extractor.extractText({
       input: url,
       type: 'url'
     }));
   default:
     const response = await fetch(url);
     if (!response.ok) throw new Error(`Failed to download ${response.statusText}`);
     return await response.text();
 }
}

async function processPromptAndMediaAttachments(prompt, message, attachments = null) {
 const allAttachments = attachments || Array.from(message.attachments.values());
 const limitedAttachments = allAttachments.slice(0, 5);

 let parts = [{ text: prompt }];

 if (limitedAttachments.length > 0) {
   // PARALLEL: Process all attachments simultaneously
   const attachmentPromises = limitedAttachments.map(async (attachment) => {
     try {
       const { processAttachment } = await import('./attachmentProcessor.js');
       return await processAttachment(attachment, message.author.id, message.id);
     } catch (error) {
       console.error(`Error processing attachment ${attachment.name}:`, error);
       return { text: `\n\n[Error processing file: ${attachment.name}]` };
     }
   });

   const processedAttachments = await Promise.all(attachmentPromises);

   for (const processedPart of processedAttachments) {
     if (processedPart) {
       if (Array.isArray(processedPart)) {
         for (const part of processedPart) {
           if (part.fileUri || part.fileData || part.inlineData) {
             parts.push(part);
           }
         }
       } else if (processedPart.fileUri || processedPart.fileData || processedPart.inlineData) {
         parts.push(processedPart);
       }
     }
   }
 }

 return parts;
}

async function handleModelResponse(
 initialBotMessage,
 modelName,
 systemInstruction,
 baseGenerationConfig,
 safetySettings,
 tools,
 history,
 parts,
 originalMessage,
 channelId,
 historyId,
 effectiveSettings,
 originalPrompt = '',
 allAttachments = []
) {
 const userId = originalMessage.author.id;
 const guildId = originalMessage.guild?.id;
 const responseFormat = effectiveSettings.responseFormat || 'Normal';
 const showActionButtons = effectiveSettings.showActionButtons === true;
 const continuousReply = effectiveSettings.continuousReply ?? true;

 const maxCharacterLimit = responseFormat === 'Embedded' ? 3900 : 1900;

 let currentModelIndex = MODEL_FALLBACK_CHAIN.indexOf(modelName);
 if (currentModelIndex === -1) {
   currentModelIndex = 0;
   modelName = MODEL_FALLBACK_CHAIN[0];
 }

 let attempts = 3;
 let modelAttempts = 0;
 const maxModelAttempts = MODEL_FALLBACK_CHAIN.length;

 const WORD_THRESHOLD = 150;

 let updateTimeout;
 let tempResponse = '';
 let groundingMetadata = null;
 let urlContextMetadata = null;

 let botMessage = initialBotMessage;

 const shouldForceReply = () => {
   if (!continuousReply) return true;
   if (guildId && originalMessage.channel.lastMessageId !== originalMessage.id) {
     return true;
   }
   return false;
 };

 const updateMessage = async () => {
   if (!botMessage) return;

   try {
     if (tempResponse.trim() === "") {
       // Skip empty updates
     } else if (responseFormat === 'Embedded') {
       updateEmbed(botMessage, tempResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
     } else {
       await botMessage.edit({
         content: tempResponse,
         embeds: []
       }).catch(() => {});
     }
   } catch (e) {}
   clearTimeout(updateTimeout);
   updateTimeout = null;
 };

 // Cleanup function to ensure typing stops and timeouts are cleared
 const cleanup = () => {
   typingManager.stop(channelId);
   if (updateTimeout) {
     clearTimeout(updateTimeout);
     updateTimeout = null;
   }
 };

 try {
   while (modelAttempts < maxModelAttempts && attempts > 0) {
     try {
       let finalResponse = '';
       let isLargeResponse = false;
       const newHistory = [];
       newHistory.push({
         role: 'user',
         content: parts
       });

       const generationConfig = getGenerationConfig(modelName);
       
       console.log(`🤖 Using model: ${modelName} (attempt ${modelAttempts + 1}/${maxModelAttempts})`);

       // Build request with original history
       const request = {
         model: modelName,
         contents: [...history, { role: 'user', parts }], 
         config: {
           systemInstruction: systemInstruction,
           ...generationConfig,
           tools: tools
         },
         safetySettings
       };

       let result = await genAI.models.generateContentStream(request);

       if (!result) {
         throw new Error('API returned undefined - check API keys');
       }

       // Stop typing once streaming begins
       typingManager.stop(channelId);

       // --- FUNCTION CALLING LOOP START ---
       let functionCallParts = [];
       
       // First streaming pass - collect function calls
       for await (const chunk of result) {
         // Check for function calls
         if (chunk.functionCalls && chunk.functionCalls.length > 0) {
           functionCallParts.push(...chunk.functionCalls);
         }
         
         // Collect text
         const chunkText = chunk.text || '';
         
         let codeOutput = "";
         if (chunk.codeExecutionResult) {
           const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
           const output = chunk.codeExecutionResult.output || '';
           if (output) {
             codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${output}\n\`\`\`\n`;
           }
         }
         
         let executableCode = "";
         if (chunk.executableCode) {
           const language = chunk.executableCode.language || 'python';
           const code = chunk.executableCode.code || '';
           if (code) {
             executableCode = `\n**Generated Code (${language}):**\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n`;
           }
         }
             
         const combinedText = chunkText + executableCode + codeOutput;
         if (combinedText && combinedText !== '') {
           finalResponse += combinedText;
           tempResponse += combinedText;

           const currentWordCount = tempResponse.trim().split(/\s+/).length;

           if (!botMessage && currentWordCount > WORD_THRESHOLD) {
             try {
               if (shouldForceReply()) {
                 botMessage = await originalMessage.reply({ content: tempResponse });
               } else {
                 botMessage = await originalMessage.channel.send({ content: tempResponse });
               }
             } catch (createErr) {
               console.error("Error creating initial message:", createErr);
               throw createErr;
             }
           }

           if (botMessage) {
             if (finalResponse.length > maxCharacterLimit) {
               if (!isLargeResponse) {
                 isLargeResponse = true;
                 const embed = new EmbedBuilder()
                   .setColor(0xFFAA00)
                   .setTitle('📄 Large Response')
                   .setDescription('The response is too large. It will be sent as a text file once completed.');

                 botMessage.edit({ content: ' ', embeds: [embed], components: [] }).catch(() => {});
               }
             } else if (!updateTimeout) {
               updateTimeout = setTimeout(updateMessage, 800);
             }
           }
         }

         if (chunk.candidates && chunk.candidates[0]?.groundingMetadata) {
           groundingMetadata = chunk.candidates[0].groundingMetadata;
         }
         if (chunk.candidates && chunk.candidates[0]?.url_context_metadata) {
           urlContextMetadata = chunk.candidates[0].url_context_metadata;
         }
       }

       // Handle function execution if calls were detected
       if (functionCallParts.length > 0) {
         console.log(`🛠️ Executing ${functionCallParts.length} function call(s)...`);
         
         // Execute function calls
         const functionResponses = await executeFunctionCalls(functionCallParts, userId, guildId);
         
         // Build the function turn with original user prompt + function call + function response
         const functionTurnParts = [
           ...parts, // Original user prompt
           // Model's function call request
           ...functionCallParts.map(call => ({
             functionCall: call
           })),
           // Function responses
           ...functionResponses
         ];

         // Call model again with function results
         const nextRequest = {
           model: modelName,
           contents: [...history, { role: 'user', parts: functionTurnParts }],
           config: { 
             systemInstruction: systemInstruction, 
             ...generationConfig, 
             tools: tools 
           },
           safetySettings
         };

         const nextResult = await genAI.models.generateContentStream(nextRequest);
         
         // Reset response for final text generation
         finalResponse = ''; 
         tempResponse = '';

         // Second streaming pass - collect final response
         for await (const chunk of nextResult) {
           const chunkText = chunk.text || '';
           
           let codeOutput = "";
           if (chunk.codeExecutionResult) {
             const outcome = chunk.codeExecutionResult.outcome || 'UNKNOWN';
             const output = chunk.codeExecutionResult.output || '';
             if (output) {
               codeOutput = `\n**Code Execution (${outcome}):**\n\`\`\`\n${output}\n\`\`\`\n`;
             }
           }
           
           let executableCode = "";
           if (chunk.executableCode) {
             const language = chunk.executableCode.language || 'python';
             const code = chunk.executableCode.code || '';
             if (code) {
               executableCode = `\n**Generated Code (${language}):**\n\`\`\`${language.toLowerCase()}\n${code}\n\`\`\`\n`;
             }
           }
               
           const combinedText = chunkText + executableCode + codeOutput;
           if (combinedText && combinedText !== '') {
             finalResponse += combinedText;
             tempResponse += combinedText;

             const currentWordCount = tempResponse.trim().split(/\s+/).length;

             if (!botMessage && currentWordCount > WORD_THRESHOLD) {
               try {
                 if (shouldForceReply()) {
                   botMessage = await originalMessage.reply({ content: tempResponse });
                 } else {
                   botMessage = await originalMessage.channel.send({ content: tempResponse });
                 }
               } catch (createErr) {
                 console.error("Error creating initial message:", createErr);
                 throw createErr;
               }
             }

             if (botMessage) {
               if (finalResponse.length > maxCharacterLimit) {
                 if (!isLargeResponse) {
                   isLargeResponse = true;
                   const embed = new EmbedBuilder()
                     .setColor(0xFFAA00)
                     .setTitle('📄 Large Response')
                     .setDescription('The response is too large. It will be sent as a text file once completed.');

                 botMessage.edit({ content: ' ', embeds: [embed], components: [] }).catch(() => {});
                 }
               } else if (!updateTimeout) {
                 updateTimeout = setTimeout(updateMessage, 800);
               }
             }
           }

           if (chunk.candidates && chunk.candidates[0]?.groundingMetadata) {
             groundingMetadata = chunk.candidates[0].groundingMetadata;
           }
           if (chunk.candidates && chunk.candidates[0]?.url_context_metadata) {
             urlContextMetadata = chunk.candidates[0].url_context_metadata;
           }
         }
       }
       // --- FUNCTION CALLING LOOP END ---

       clearTimeout(updateTimeout);

       let wasShortResponse = false;
       
       if (!botMessage && finalResponse) {
         wasShortResponse = true;
         if (shouldForceReply()) {
           botMessage = await originalMessage.reply({ content: finalResponse });
         } else {
           botMessage = await originalMessage.channel.send({ content: finalResponse });
         }
       }

       newHistory.push({
         role: 'assistant',
         content: [{ text: finalResponse }]
       });

       if (botMessage) {
         if (!isLargeResponse && responseFormat === 'Embedded') {
           updateEmbed(botMessage, finalResponse, originalMessage, groundingMetadata, urlContextMetadata, effectiveSettings);
         } else if (!isLargeResponse && !wasShortResponse) {
           await botMessage.edit({
             content: finalResponse.slice(0, 2000),
             embeds: []
           }).catch(() => {});
         }
       }

       if (isLargeResponse && botMessage) {
         botMessage = await sendAsTextFile(finalResponse, originalMessage, botMessage.id, continuousReply);
       }

       if (showActionButtons && botMessage && !isLargeResponse) {
         const { addDownloadButton, addDeleteButton } = await import('./buttonHandlers.js');
         botMessage = await addDownloadButton(botMessage);
         botMessage = await addDeleteButton(botMessage, botMessage.id);
       }

       // BACKGROUND SAVE: Don't await - run in background (NON-BLOCKING)
       if (newHistory.length > 1 && botMessage) {
         chatHistoryLock.runExclusive(async () => {
           const username = originalMessage.author.username;
           const displayName = originalMessage.author.displayName;
           updateChatHistory(historyId, newHistory, botMessage.id, username, displayName);
           
           // Store in memory system for RAG (non-blocking)
           memorySystem.storeMemoryWithEmbedding(
             historyId,
             newHistory,
             userId,
             guildId
           ).catch(err => console.error('Background memory save failed:', err));
           
           await saveStateToFile();
         }).catch(err => console.error('Background history save failed:', err));
       }
       
       // Success - cleanup and exit
       cleanup();
       break;

          } catch (error) {
       attempts--;

       // 1. Immediately trigger key rotation in botManager
       // Note: Ensure switchToNextKey in botManager.js returns true if key changed
       const rotated = switchToNextKey(error);

       // 2. If a rotation happened, pre-emptively fix context in parallel
       if (rotated && attempts > 0) {
         typingManager.start(originalMessage.channel);

         try {
           // Run history cleaning and file re-uploads at the same time for speed
           const [cleanedHistory, reprocessedResult] = await Promise.all([
             Promise.resolve(cleanHistoryFiles(history)),
             (async () => {
               const { finalPrompt, summaryParts } = await extractFileText(originalMessage, originalPrompt);
               let updatedParts = await processPromptAndMediaAttachments(
                 finalPrompt,
                 originalMessage,
                 allAttachments
               );
               if (summaryParts && summaryParts.length > 0) {
                 updatedParts.push(...summaryParts);
               }
               return updatedParts;
             })()
           ]);

           // Update variables with fresh data and retry the loop immediately
           history = cleanedHistory;
           parts = reprocessedResult;
           continue; 
         } catch (reProcessErr) {
           console.error("Failed to re-prepare context after rotation:", reProcessErr);
         }
       }
      
       // 3. Fallback logic if no rotation occurred or it was a rate limit
       const isRateLimitError = RATE_LIMIT_ERRORS.some(code => 
         error.message?.includes(code) || 
         error.status === code || 
         error.code?.includes(code)
       );

       if (isRateLimitError) {
         console.log(`⚠️ Rate limit hit on ${modelName}, attempting fallback...`);
         typingManager.start(originalMessage.channel);
         
         currentModelIndex++;
         if (currentModelIndex < MODEL_FALLBACK_CHAIN.length) {
           modelName = MODEL_FALLBACK_CHAIN[currentModelIndex];
           modelAttempts++;
           attempts = 3; 
           console.log(`🔄 Falling back to ${modelName}`);
           await delay(2000);
           continue; 
         }
       }
      
       if (attempts === 0 && modelAttempts >= maxModelAttempts - 1) {
         cleanup();
         const embed = new EmbedBuilder()
           .setColor(0xFF0000)
           .setTitle('❌ Generation Failed')
           .setDescription(`All models failed. Last error: ${error.message || 'Unknown error'}\n\nTried: ${MODEL_FALLBACK_CHAIN.slice(0, modelAttempts + 1).join(', ')}`);
         try {
           if (shouldForceReply()) await originalMessage.reply({ embeds: [embed] });
           else await originalMessage.channel.send({ embeds: [embed] });
         } catch (e) {}
         break;
       } else {
         await delay(1500);
       }
     }
   }
 } catch (outerError) {
   console.error('Critical error in handleModelResponse:', outerError);
   cleanup();
   
   try {
     const embed = new EmbedBuilder()
       .setColor(0xFF0000)
       .setTitle('❌ Critical Error')
       .setDescription('A critical error occurred during response generation.');
     await originalMessage.reply({ embeds: [embed] });
   } catch (e) {}
 } finally {
   // Ensure cleanup always happens
   cleanup();
 }

}


