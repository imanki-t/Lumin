/**
 * @fileoverview File upload pipeline. Handles downloading Discord attachments,
 *               routing them through the appropriate conversion strategy, and
 *               uploading to the Gemini Files API. The main export is
 *               `processAttachment`.
 * @module modules/attachments/FileUploader
 */

import path             from 'path';
import fs               from 'fs/promises';
import { createWriteStream } from 'fs';
import axios            from 'axios';

import { genAI, TEMP_DIR, createPartFromUri } from '../../managers/BotManager.js';
import { Logger }       from '../../core/Logger.js';

import { downloadAndReadFile } from '../../utils.js';

import {
  MIME_TYPES, FILE_EXTENSIONS, CONVERSION_MESSAGES, ERROR_MESSAGES,
  isUnsupportedFile, canUploadDirectly, needsImageConversion,
  needsAudioConversion, needsVideoConversion, needsTextExtraction,
  isAnimatedContent, determineFileType, determineDocumentType,
  resolveMimeType, sanitizeFileName, generateUniqueFilename
} from './FileValidator.js';

import {
  waitForVideoProcessing, waitForGifProcessing,
  convertGifToVideo, convertGifToPng, convertImageToPng,
  convertAudioToMp3, convertVideoToMp4
} from './FileConverter.js';

const logger = Logger.get('FileUploader');

// ============================================================================
// I/O HELPERS
// ============================================================================

/**
 * Streams a remote URL to a local file path.
 * @param {string} url
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function downloadFile(url, filePath) {
  const writer   = createWriteStream(filePath);
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

/**
 * Silently deletes one or more temp files. Swallows errors so a missing file
 * never crashes the pipeline.
 * @param {...string} filePaths
 */
async function cleanupFiles(...filePaths) {
  await Promise.all(filePaths.map(fp => fs.unlink(fp).catch(() => {})));
}

// ============================================================================
// PROCESS STRATEGIES
// ============================================================================

/**
 * Handles animated GIF / sticker / emoji.
 * Primary path: convert to MP4 and upload. Fallback: extract first frame as PNG.
 * Partial MP4 files created before a conversion error are cleaned up in the catch block.
 * @param {string} filePath
 * @param {string} sanitizedFileName
 * @param {object} attachment - Discord attachment / pseudo-attachment
 * @returns {Promise<Array>} Gemini parts array [text, fileData]
 */
async function processAnimatedContent(filePath, sanitizedFileName, attachment) {
  // Derive what the mp4 path will be (convertGifToVideo uses same pattern)
  const expectedMp4 = filePath.replace(/\.(gif|png|jpg|jpeg)$/i, '.mp4');

  try {
    const mp4FilePath  = await convertGifToVideo(filePath);

    const uploadResult = await genAI.files.upload({
      file:   mp4FilePath,
      config: { mimeType: MIME_TYPES.MP4, displayName: sanitizedFileName.replace(/\.gif$/i, '.mp4') }
    });

    if (!uploadResult.name) throw new Error(ERROR_MESSAGES.NO_FILE_NAME);

    await waitForGifProcessing(uploadResult.name);
    await cleanupFiles(filePath, mp4FilePath);

    let metadata;
    if (attachment.isSticker && attachment.isAnimated) {
      metadata = `[${CONVERSION_MESSAGES.STICKER_TO_VIDEO}: ${attachment.name} (${MIME_TYPES.MP4})]`;
    } else if (attachment.isEmoji && attachment.isAnimated) {
      metadata = `[${CONVERSION_MESSAGES.EMOJI_TO_VIDEO} (:${attachment.emojiName}:) (${MIME_TYPES.MP4})]`;
    } else {
      metadata = `[${CONVERSION_MESSAGES.GIF_TO_VIDEO}: ${sanitizedFileName} (${MIME_TYPES.MP4})]`;
    }

    return [
      { text: metadata },
      createPartFromUri(uploadResult.uri, uploadResult.mimeType)
    ];

  } catch (gifError) {
    logger.warn(`GIF-to-video failed, falling back to PNG frame: ${gifError.message}`);

    // Clean up partial mp4 that convertGifToVideo may have created before throwing.
    await cleanupFiles(expectedMp4).catch(() => {});

    const pngFilePath  = await convertGifToPng(filePath);
    const uploadResult = await genAI.files.upload({
      file:   pngFilePath,
      config: { mimeType: MIME_TYPES.PNG, displayName: sanitizedFileName.replace(/\.(gif|png|jpg|jpeg)$/i, '.png') }
    });
    await cleanupFiles(filePath, pngFilePath);

    let fallbackMetadata;
    if (attachment.isSticker && attachment.isAnimated) {
      fallbackMetadata = `[${CONVERSION_MESSAGES.STICKER_TO_PNG}: ${attachment.name} (${MIME_TYPES.PNG})]`;
    } else if (attachment.isEmoji && attachment.isAnimated) {
      fallbackMetadata = `[${CONVERSION_MESSAGES.EMOJI_TO_PNG}: :${attachment.emojiName}: (${MIME_TYPES.PNG})]`;
    } else {
      fallbackMetadata = `[${CONVERSION_MESSAGES.GIF_TO_PNG}: ${sanitizedFileName} (${MIME_TYPES.PNG})]`;
    }

    return [
      { text: fallbackMetadata },
      createPartFromUri(uploadResult.uri, uploadResult.mimeType)
    ];
  }
}

/**
 * Uploads a file that the Gemini Files API accepts directly (no conversion).
 * Polls for processing completion on videos.
 * @param {string} filePath
 * @param {string} sanitizedFileName
 * @param {string} contentType
 * @param {string} fileExtension
 * @returns {Promise<Array>} Gemini parts array [text, fileData]
 */
async function processDirectUpload(filePath, sanitizedFileName, contentType, fileExtension) {
  const mimeType     = resolveMimeType(contentType, fileExtension);
  const uploadResult = await genAI.files.upload({
    file:   filePath,
    config: { mimeType, displayName: sanitizedFileName }
  });

  if (!uploadResult.name) throw new Error(ERROR_MESSAGES.NO_FILE_NAME);

  if (FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD.includes(fileExtension)) {
    await waitForVideoProcessing(uploadResult.name);
  }

  await cleanupFiles(filePath);

  const fileTypeDescription = determineFileType(fileExtension, mimeType);
  return [
    { text: `[${fileTypeDescription} uploaded: ${sanitizedFileName} (${mimeType})]` },
    createPartFromUri(uploadResult.uri, uploadResult.mimeType)
  ];
}

/**
 * Converts an image to PNG and uploads it.
 * @param {string} filePath
 * @param {string} sanitizedFileName
 * @param {string} fileExtension
 * @param {object} attachment
 * @returns {Promise<Array>}
 */
async function processImageConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const pngFilePath  = await convertImageToPng(filePath);
  const uploadResult = await genAI.files.upload({
    file:   pngFilePath,
    config: { mimeType: MIME_TYPES.PNG, displayName: sanitizedFileName.replace(/\.[^.]+$/, '.png') }
  });
  await cleanupFiles(filePath, pngFilePath);
  return [
    { text: `[${CONVERSION_MESSAGES.IMAGE_CONVERTED} ${fileExtension.toUpperCase()} to PNG: ${attachment.name} (${MIME_TYPES.PNG})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.PNG)
  ];
}

/**
 * Converts an audio file to MP3 and uploads it.
 * @param {string} filePath
 * @param {string} sanitizedFileName
 * @param {string} fileExtension
 * @param {object} attachment
 * @returns {Promise<Array>}
 */
async function processAudioConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const mp3FilePath  = await convertAudioToMp3(filePath);
  const uploadResult = await genAI.files.upload({
    file:   mp3FilePath,
    config: { mimeType: MIME_TYPES.MPEG_AUDIO, displayName: sanitizedFileName.replace(/\.[^.]+$/, '.mp3') }
  });
  await cleanupFiles(filePath, mp3FilePath);
  return [
    { text: `[${CONVERSION_MESSAGES.AUDIO_CONVERTED} ${fileExtension.toUpperCase()} to MP3: ${attachment.name} (${MIME_TYPES.MPEG_AUDIO})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.MPEG_AUDIO)
  ];
}

/**
 * Converts a video file to MP4 and uploads it.
 * @param {string} filePath
 * @param {string} sanitizedFileName
 * @param {string} fileExtension
 * @param {object} attachment
 * @returns {Promise<Array>}
 */
async function processVideoConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const mp4FilePath  = await convertVideoToMp4(filePath);
  const uploadResult = await genAI.files.upload({
    file:   mp4FilePath,
    config: { mimeType: MIME_TYPES.MP4, displayName: sanitizedFileName.replace(/\.[^.]+$/, '.mp4') }
  });
  await waitForVideoProcessing(uploadResult.name);
  await cleanupFiles(filePath, mp4FilePath);
  return [
    { text: `[${CONVERSION_MESSAGES.VIDEO_CONVERTED} ${fileExtension.toUpperCase()} to MP4: ${attachment.name} (${MIME_TYPES.MP4})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.MP4)
  ];
}

/**
 * Reads text from an office/markup/code file and uploads it as plain text.
 * Note: does NOT download to `filePath` — uses `downloadAndReadFile` directly.
 * @param {object} attachment
 * @param {string} sanitizedFileName
 * @param {string} fileExtension
 * @param {string} uniqueTempFilename - used to make the extracted .txt path unique
 * @returns {Promise<Array>}
 */
async function processTextExtraction(attachment, sanitizedFileName, fileExtension, uniqueTempFilename) {
  const fileContent = await downloadAndReadFile(attachment.url, fileExtension);
  const txtFileName = sanitizedFileName.replace(/\.[^.]+$/, '.txt');
  const txtFilePath = path.join(TEMP_DIR, `extracted-${uniqueTempFilename}.txt`);

  await fs.writeFile(txtFilePath, fileContent, 'utf8');

  const uploadResult = await genAI.files.upload({
    file:   txtFilePath,
    config: { mimeType: MIME_TYPES.TEXT_PLAIN, displayName: txtFileName }
  });
  await cleanupFiles(txtFilePath);

  const originalType = determineDocumentType(fileExtension);
  return [
    { text: `[${originalType} ${CONVERSION_MESSAGES.DOCUMENT_EXTRACTED}: ${attachment.name} (converted to ${MIME_TYPES.TEXT_PLAIN})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.TEXT_PLAIN)
  ];
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Processes a single Discord attachment and returns Gemini API parts.
 *
 * Routing order:
 *   1. Unsupported → return error text part
 *   2. Direct upload (images/video/audio/pdf/txt) → optionally route animated
 *      GIFs through conversion
 *   3. Image conversion (SVG, AVIF, RAW, etc.) → PNG
 *   4. Audio conversion (WMA, AMR, MIDI, etc.) → MP3
 *   5. Video conversion (MKV, OGV, etc.) → MP4
 *   6. Text extraction (Office, markup, code) → plain text upload
 *   7. Unknown → warning text part
 *
 * @param {object} attachment - Discord attachment or pseudo-attachment object
 * @param {string} attachment.url
 * @param {string} attachment.name
 * @param {string} [attachment.contentType]
 * @param {boolean} [attachment.isSticker]
 * @param {boolean} [attachment.isAnimated]
 * @param {boolean} [attachment.isEmoji]
 * @param {string}  [attachment.emojiName]
 * @param {string}  userId
 * @param {string}  interactionId
 * @returns {Promise<object|Array>} Single text part on error, or [text, fileData] array on success
 */
export async function processAttachment(attachment, userId, interactionId) {
  const contentType   = (attachment.contentType || '').toLowerCase();
  const fileExtension = path.extname(attachment.name).toLowerCase();

  // Step 1 — reject unsupported types immediately (no download)
  if (isUnsupportedFile(fileExtension)) {
    logger.warn(`Unsupported file type: ${attachment.name} (${contentType})`);
    return {
      text: `\n\n[❌ ${ERROR_MESSAGES.UNSUPPORTED}: ${attachment.name}]\n${ERROR_MESSAGES.UNSUPPORTED_DESC}`
    };
  }

  const sanitizedFileName  = sanitizeFileName(attachment.name);
  const uniqueTempFilename = generateUniqueFilename(userId, interactionId, sanitizedFileName);
  const filePath           = path.join(TEMP_DIR, uniqueTempFilename);

  try {
    // Step 2 — direct upload (with animated-content detour)
    if (canUploadDirectly(fileExtension)) {
      await downloadFile(attachment.url, filePath);

      if (isAnimatedContent(attachment, contentType, fileExtension)) {
        return await processAnimatedContent(filePath, sanitizedFileName, attachment);
      }

      return await processDirectUpload(filePath, sanitizedFileName, contentType, fileExtension);
    }

    // Step 3 — image conversion
    if (needsImageConversion(fileExtension)) {
      await downloadFile(attachment.url, filePath);
      return await processImageConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    // Step 4 — audio conversion
    if (needsAudioConversion(fileExtension)) {
      await downloadFile(attachment.url, filePath);
      return await processAudioConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    // Step 5 — video conversion
    if (needsVideoConversion(fileExtension)) {
      await downloadFile(attachment.url, filePath);
      return await processVideoConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    // Step 6 — text extraction (does its own download internally)
    if (needsTextExtraction(fileExtension)) {
      return await processTextExtraction(attachment, sanitizedFileName, fileExtension, uniqueTempFilename);
    }

    // Step 7 — unknown format
    logger.warn(`Unhandled file type: ${attachment.name} (${contentType})`);
    return { text: `\n\n[⚠️ ${ERROR_MESSAGES.UNKNOWN_FORMAT}: ${attachment.name}]` };

  } catch (error) {
    logger.error(`Error processing ${attachment.name}`, error);

    // Best-effort cleanup of the primary temp file
    await cleanupFiles(filePath);

    const errorType = error.message?.includes('convert')  ? ERROR_MESSAGES.CONVERSION_FAILED  :
                      error.message?.includes('extract')  ? ERROR_MESSAGES.EXTRACTION_FAILED  :
                      'Processing error';

    return { text: `\n\n[❌ ${errorType}: ${attachment.name}]` };
  }
}
