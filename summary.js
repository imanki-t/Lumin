/**
 * @fileoverview Summary Command - Summarize Discord conversations, YouTube videos, and websites
 * @version 3.0.0
 * @module commands/summary
 * 
 * Features:
 * - Discord conversation summarization
 * - YouTube video summarization
 * - Website content summarization (NEW)
 * - Professional retry logic with key rotation
 * - Rate limiting and usage tracking
 * - Streaming responses for better UX
 * 
 * @requires discord.js ^14.16.3
 * @requires @google/genai ^1.0.1
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { genAI, TEMP_DIR, checkSummaryRateLimit, incrementSummaryUsage, switchToNextKey } from '../botManager.js';
import { fetchMessagesForSummary } from '../modules/utils.js';
import { MODELS, safetySettings, getGenerationConfig, RATE_LIMIT_ERRORS, MODEL_FALLBACK_CHAIN, DEFAULT_MODEL } from '../modules/config.js';
import path from 'path';
import fs from 'fs/promises';

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** Model optimized for summarization tasks */
const SUMMARY_MODEL = 'gemini-2.5-flash';

/** Maximum retry attempts for API calls */
const MAX_RETRY_ATTEMPTS = 3;

/** Maximum file upload retry attempts */
const MAX_UPLOAD_RETRIES = 3;

/** Maximum wait time for file processing (seconds) */
const MAX_PROCESSING_WAIT = 60;

/** Delay between file processing checks (ms) */
const PROCESSING_CHECK_DELAY = 2000;

// ============================================================================
// URL VALIDATION HELPERS
// ============================================================================

/**
 * Check if URL is a YouTube video
 * @param {string} url - URL to check
 * @returns {boolean} True if YouTube URL
 */
function isYouTubeUrl(url) {
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
  return ytRegex.test(url);
}

/**
 * Check if URL is a Discord message link
 * @param {string} url - URL to check
 * @returns {boolean} True if Discord message link
 */
function isDiscordMessageLink(url) {
  const discordRegex = /https?:\/\/(?:www\.)?discord\.com\/channels\/\d+\/\d+\/\d+/;
  return discordRegex.test(url);
}

/**
 * Check if URL is a generic website
 * @param {string} url - URL to check
 * @returns {boolean} True if valid website URL
 */
function isWebsiteUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================================================
// RETRY LOGIC WITH KEY ROTATION
// ============================================================================

/**
 * Execute API call with retry logic and key rotation
 * Handles file permission errors and rate limits
 * 
 * @param {Function} apiCallFn - Function that takes model name and returns API result
 * @param {string} initialModel - Initial model to try
 * @param {Function|null} reuploadCallback - Callback to re-upload files after key rotation
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
async function executeWithRetry(apiCallFn, initialModel, reuploadCallback = null) {
  let attempts = 0;
  let currentModel = initialModel;
  let currentModelIndex = MODEL_FALLBACK_CHAIN.indexOf(initialModel);
  
  if (currentModelIndex === -1) {
    currentModelIndex = 0;
    currentModel = MODEL_FALLBACK_CHAIN[0];
  }

  while (attempts < MAX_RETRY_ATTEMPTS) {
    try {
      attempts++;
      console.log(`📝 Summary attempt ${attempts}/${MAX_RETRY_ATTEMPTS} with ${currentModel}`);

      const result = await apiCallFn(currentModel);
      
      console.log(`✅ Summary generated successfully`);
      return { success: true, result };

    } catch (error) {
      console.error(`❌ Summary attempt ${attempts} failed:`, error.message);

      // Check if this is a file permission error (key rotation artifact)
      const isFileError = 
        (error?.status === 403 || error?.code === 403 || error?.message?.includes('403')) &&
        (error?.message?.includes('File') || 
         error?.message?.includes('file') || 
         error?.message?.includes('PERMISSION_DENIED'));

      // Handle file errors with re-upload
      if (isFileError && reuploadCallback && attempts < MAX_RETRY_ATTEMPTS) {
        console.log(`🔄 File permission error - re-uploading with new key...`);
        
        try {
          await reuploadCallback();
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        } catch (reuploadError) {
          console.error('❌ File re-upload failed:', reuploadError);
          return {
            success: false,
            error: 'File upload failed after key rotation'
          };
        }
      }

      // Check for rate limit errors
      const isRateLimit = RATE_LIMIT_ERRORS.some(code => 
        error?.message?.includes(code) || 
        error?.status === code || 
        error?.code?.includes(code)
      );

      if (isRateLimit) {
        console.log(`⏱️ Rate limit hit, attempting key rotation...`);
        switchToNextKey(error);
        
        // Try fallback model if available
        currentModelIndex++;
        if (currentModelIndex < MODEL_FALLBACK_CHAIN.length) {
          currentModel = MODEL_FALLBACK_CHAIN[currentModelIndex];
          console.log(`🔄 Falling back to ${currentModel}`);
        }
        
        const delay = Math.min(1000 * Math.pow(2, attempts), 8000);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, just retry with delay
      if (attempts < MAX_RETRY_ATTEMPTS) {
        const delay = 1000 * attempts;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // All retries exhausted
      return {
        success: false,
        error: error.message || 'Unknown error after all retries'
      };
    }
  }

  return {
    success: false,
    error: 'Maximum retry attempts exceeded'
  };
}

/**
 * Upload file with retry logic
 * @param {string} filePath - Path to file
 * @param {Object} config - Upload configuration
 * @returns {Promise<{success: boolean, result?: any, error?: string}>}
 */
async function uploadFileWithRetry(filePath, config) {
  let attempts = 0;

  while (attempts < MAX_UPLOAD_RETRIES) {
    try {
      attempts++;
      console.log(`📤 Upload attempt ${attempts}/${MAX_UPLOAD_RETRIES}`);

      const uploadResult = await genAI.files.upload({
        file: filePath,
        config
      });

      console.log(`✅ File uploaded successfully`);
      return { success: true, result: uploadResult };

    } catch (error) {
      console.error(`❌ Upload attempt ${attempts} failed:`, error.message);

      const isRateLimit = RATE_LIMIT_ERRORS.some(code => 
        error?.message?.includes(code) || 
        error?.status === code || 
        error?.code?.includes(code)
      );

      if (isRateLimit && attempts < MAX_UPLOAD_RETRIES) {
        switchToNextKey(error);
        const delay = Math.min(1000 * Math.pow(2, attempts), 8000);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (attempts >= MAX_UPLOAD_RETRIES) {
        return {
          success: false,
          error: error.message || 'Upload failed after retries'
        };
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return {
    success: false,
    error: 'Upload retry loop exited unexpectedly'
  };
}

/**
 * Wait for file to finish processing
 * @param {string} fileName - File name to check
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function waitForFileProcessing(fileName) {
  let attempts = 0;
  const maxAttempts = Math.ceil(MAX_PROCESSING_WAIT / (PROCESSING_CHECK_DELAY / 1000));

  while (attempts < maxAttempts) {
    try {
      const file = await genAI.files.get({ name: fileName });
      
      if (file.state === 'ACTIVE') {
        console.log(`✅ File processing complete`);
        return { success: true };
      }
      
      if (file.state === 'FAILED') {
        console.error(`❌ File processing failed`);
        return { success: false, error: 'File processing failed' };
      }

      // Still processing
      attempts++;
      await new Promise(resolve => setTimeout(resolve, PROCESSING_CHECK_DELAY));

    } catch (error) {
      console.error(`❌ Error checking file status:`, error.message);
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'File processing timeout' };
}

// ============================================================================
// SUMMARIZATION HANDLERS
// ============================================================================

/**
 * Summarize a YouTube video
 * @param {Interaction} interaction - Discord interaction
 * @param {string} videoUrl - YouTube video URL
 */
async function summarizeYouTubeVideo(interaction, videoUrl) {
  try {
    console.log(`📺 Summarizing YouTube video: ${videoUrl}`);

    const apiCallFn = async (modelName) => {
      const request = {
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { 
                text: "Provide a comprehensive, structured summary of this YouTube video. " +
                      "Include:\n" +
                      "• Main topics and key points\n" +
                      "• Important takeaways\n" +
                      "• Notable quotes or moments\n" +
                      "Keep it concise and well-organized with bullet points." 
              },
              { fileData: { fileUri: videoUrl, mimeType: 'video/mp4' } }
            ]
          }
        ],
        config: {
          ...getGenerationConfig(modelName)
        },
        safetySettings
      };

      return await genAI.models.generateContent(request);
    };

    const response = await executeWithRetry(apiCallFn, SUMMARY_MODEL);

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate video summary');
    }

    const summaryText = response.result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summaryText || summaryText.trim() === '') {
      throw new Error('Gemini returned an empty response');
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('📺 YouTube Video Summary')
      .setURL(videoUrl)
      .setDescription(summaryText.slice(0, 4000))
      .setFooter({ text: 'Summarized by Lumin • Gemini AI' })
      .setTimestamp();

    incrementSummaryUsage(interaction.user.id);
    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('❌ YouTube summarization failed:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Video Summary Failed')
      .setDescription(
        'I couldn\'t summarize that video. Please ensure:\n' +
        '• The video is public and not age-restricted\n' +
        '• The video has captions or transcripts available\n' +
        '• The video is not too long (>2 hours)\n\n' +
        `*Error: ${error.message}*`
      );
    
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

/**
 * Summarize a Discord conversation
 * @param {Interaction} interaction - Discord interaction
 * @param {string} messageLink - Discord message link
 * @param {number} count - Number of messages to summarize
 */
async function summarizeDiscordConversation(interaction, messageLink, count) {
  let filePath = null;

  try {
    console.log(`💬 Summarizing Discord conversation: ${count} messages`);

    // Fetch messages
    const result = await fetchMessagesForSummary(interaction, messageLink, count);

    if (result.error) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Discord Summary Failed')
        .setDescription(result.error);
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    if (!result.success || !result.content) {
      throw new Error('Failed to fetch messages');
    }

    // Create text file with conversation
    const fileName = `discord_summary_${interaction.id}_${Date.now()}.txt`;
    filePath = path.join(TEMP_DIR, fileName);
    
    const fileContent = 
      `Discord Conversation Summary\n` +
      `Channel: #${result.channelName}\n` +
      `Server: ${result.guildName}\n` +
      `Messages: ${result.messageCount}\n` +
      `${'='.repeat(50)}\n\n` +
      `${result.content}`;

    await fs.writeFile(filePath, fileContent, 'utf8');

    // Upload file with retry
    const uploadResponse = await uploadFileWithRetry(filePath, {
      mimeType: 'text/plain',
      displayName: 'Discord Conversation Data'
    });

    if (!uploadResponse.success) {
      throw new Error(uploadResponse.error || 'File upload failed');
    }

    const uploadResult = uploadResponse.result;

    // Wait for file processing
    const processingResult = await waitForFileProcessing(uploadResult.name);
    
    if (!processingResult.success) {
      throw new Error(processingResult.error || 'File processing failed');
    }

    // Create reupload callback for key rotation handling
    let currentFileUri = uploadResult.uri;
    
    const reuploadCallback = async () => {
      console.log('🔄 Re-uploading Discord conversation file after key rotation...');
      
      const newUpload = await uploadFileWithRetry(filePath, {
        mimeType: 'text/plain',
        displayName: 'Discord Conversation Data'
      });

      if (!newUpload.success) {
        throw new Error('Re-upload failed');
      }

      const newProcessing = await waitForFileProcessing(newUpload.result.name);
      
      if (!newProcessing.success) {
        throw new Error('Re-uploaded file processing failed');
      }

      currentFileUri = newUpload.result.uri;
    };

    // Generate summary
    const apiCallFn = async (modelName) => {
      const request = {
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { 
                text: "Analyze and summarize this Discord conversation. Include:\n" +
                      "• Main topics discussed\n" +
                      "• Key decisions or conclusions\n" +
                      "• Overall tone and mood\n" +
                      "• Notable participants\n" +
                      "Be concise and use bullet points." 
              },
              { fileData: { fileUri: currentFileUri, mimeType: 'text/plain' } }
            ]
          }
        ],
        config: {
          ...getGenerationConfig(modelName)
        },
        safetySettings
      };

      return await genAI.models.generateContent(request);
    };

    const response = await executeWithRetry(apiCallFn, SUMMARY_MODEL, reuploadCallback);

    // Clean up file
    await fs.unlink(filePath).catch(() => {});
    filePath = null;

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate summary');
    }

    const summaryText = response.result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summaryText || summaryText.trim() === '') {
      throw new Error('Generated summary was empty');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('💬 Discord Conversation Summary')
      .setDescription(summaryText.slice(0, 4000))
      .addFields(
        { name: '📍 Location', value: `#${result.channelName} (${result.guildName})`, inline: true },
        { name: '💬 Messages', value: result.messageCount.toString(), inline: true }
      )
      .setFooter({ text: 'Summarized by Lumin • Gemini AI' })
      .setTimestamp();

    incrementSummaryUsage(interaction.user.id);
    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('❌ Discord summarization failed:', error);
    
    // Clean up file
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }

    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Conversation Summary Failed')
      .setDescription(`Failed to summarize the Discord conversation.\n\n*Error: ${error.message}*`);
    
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

/**
 * Summarize a website
 * @param {Interaction} interaction - Discord interaction
 * @param {string} websiteUrl - Website URL
 */
async function summarizeWebsite(interaction, websiteUrl) {
  try {
    console.log(`🌐 Summarizing website: ${websiteUrl}`);

    const apiCallFn = async (modelName) => {
      const request = {
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { 
                text: `Please provide a comprehensive summary of this website: ${websiteUrl}\n\n` +
                      "Include:\n" +
                      "• Main purpose and content\n" +
                      "• Key information and takeaways\n" +
                      "• Important sections or features\n" +
                      "Use bullet points and keep it concise." 
              }
            ]
          }
        ],
        config: {
          ...getGenerationConfig(modelName),
          tools: [
            { urlContext: {} },
            { googleSearch: {} }
          ]
        },
        safetySettings
      };

      return await genAI.models.generateContent(request);
    };

    const response = await executeWithRetry(apiCallFn, SUMMARY_MODEL);

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate website summary');
    }

    const summaryText = response.result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summaryText || summaryText.trim() === '') {
      throw new Error('Generated summary was empty');
    }

    // Extract URL context metadata if available
    const urlContextMetadata = response.result.candidates?.[0]?.url_context_metadata;
    
    const embed = new EmbedBuilder()
      .setColor(0x00D9FF)
      .setTitle('🌐 Website Summary')
      .setURL(websiteUrl)
      .setDescription(summaryText.slice(0, 4000))
      .setFooter({ text: 'Summarized by Lumin • Gemini AI' })
      .setTimestamp();

    // Add URL context status if available
    if (urlContextMetadata?.url_metadata?.length > 0) {
      const urlStatus = urlContextMetadata.url_metadata[0];
      const statusEmoji = urlStatus.url_retrieval_status === 'URL_RETRIEVAL_STATUS_SUCCESS' ? '✅' : '⚠️';
      
      embed.addFields({
        name: '🔗 URL Status',
        value: `${statusEmoji} ${urlStatus.url_retrieval_status}`,
        inline: false
      });
    }

    incrementSummaryUsage(interaction.user.id);
    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('❌ Website summarization failed:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF5555)
      .setTitle('❌ Website Summary Failed')
      .setDescription(
        'I couldn\'t summarize that website. Please ensure:\n' +
        '• The URL is valid and accessible\n' +
        '• The website is not behind a paywall or login\n' +
        '• The website allows web scraping\n\n' +
        `*Error: ${error.message}*`
      );
    
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

// ============================================================================
// MAIN COMMAND HANDLER
// ============================================================================

/**
 * Command metadata
 */
export const summaryCommand = {
  name: 'summary',
  description: 'Summarize a Discord conversation, YouTube video, or website'
};

/**
 * Main command handler
 * Routes to appropriate summarization function based on URL type
 * 
 * @param {Interaction} interaction - Discord interaction
 */
export async function handleSummaryCommand(interaction) {
  try {
    // Check rate limit
    const limitCheck = checkSummaryRateLimit(interaction.user.id);
    
    if (!limitCheck.allowed) {
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('⏳ Rate Limit Reached')
        .setDescription(limitCheck.message);
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }

    const inputLink = interaction.options.getString('link');
    const count = interaction.options.getInteger('count') || 50;

    // Validate input
    if (!inputLink || inputLink.trim() === '') {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Invalid Input')
        .setDescription('Please provide a valid link to summarize.');
      
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    // Route to appropriate handler based on URL type
    if (isYouTubeUrl(inputLink)) {
      await summarizeYouTubeVideo(interaction, inputLink);
    } 
    else if (isDiscordMessageLink(inputLink)) {
      await summarizeDiscordConversation(interaction, inputLink, count);
    } 
    else if (isWebsiteUrl(inputLink)) {
      await summarizeWebsite(interaction, inputLink);
    } 
    else {
      const embed = new EmbedBuilder()
        .setColor(0xFF5555)
        .setTitle('❌ Unsupported URL')
        .setDescription(
          'I can only summarize:\n' +
          '• YouTube videos\n' +
          '• Discord message links\n' +
          '• Website URLs\n\n' +
          'Please provide a valid link.'
        );
      
      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    console.error('❌ Critical error in summary command:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('❌ Unexpected Error')
      .setDescription('An unexpected error occurred while processing the summary. Please try again later.');

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        embeds: [errorEmbed], 
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    } else {
      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    }
  }
}
