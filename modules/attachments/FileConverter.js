/**
 * @fileoverview Media conversion utilities. Wraps fluent-ffmpeg and sharp
 *               to convert non-native formats into ones the Gemini Files API
 *               accepts. Also handles the video processing poll loop.
 * @module modules/attachments/FileConverter
 */

import ffmpeg from 'fluent-ffmpeg';
import { genAI } from '../../managers/BotManager.js';
import { Logger } from '../../core/Logger.js';
import {
  PROCESSING_TIMEOUTS,
  VIDEO_CONVERSION_OPTIONS,
  AUDIO_CONVERSION_OPTIONS,
  FILE_STATES,
  ERROR_MESSAGES
} from './FileValidator.js';

const logger = Logger.get('FileConverter');

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Pause execution for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps fluent-ffmpeg in a Promise so async/await callers can use it cleanly.
 * @param {import('fluent-ffmpeg').FfmpegCommand} cmd
 * @returns {Promise<void>}
 */
function ffmpegPromise(cmd) {
  return new Promise((resolve, reject) => {
    cmd.on('end', resolve).on('error', reject).run();
  });
}

// ============================================================================
// VIDEO PROCESSING POLL
// ============================================================================

/**
 * Polls the Gemini Files API until a video file transitions out of PROCESSING state.
 * Throws on FAILED state or timeout — callers must handle both.
 * @param {string} fileName - Gemini file resource name (e.g. "files/abc123")
 * @returns {Promise<void>}
 * @throws {Error} on FAILED state or timeout
 */
export async function waitForVideoProcessing(fileName) {
  let file     = await genAI.files.get({ name: fileName });
  let attempts = 0;

  while (file.state === FILE_STATES.PROCESSING && attempts < PROCESSING_TIMEOUTS.MAX_ATTEMPTS) {
    await sleep(PROCESSING_TIMEOUTS.VIDEO_WAIT_MS);
    file = await genAI.files.get({ name: fileName });
    attempts++;
  }

  if (file.state === FILE_STATES.FAILED) {
    throw new Error(ERROR_MESSAGES.VIDEO_PROCESSING_FAILED);
  }

  // Any state other than SUCCESS after the loop means processing timed out.
  if (file.state !== FILE_STATES.SUCCESS) {
    throw new Error(ERROR_MESSAGES.VIDEO_PROCESSING_TIMEOUT);
  }
}

/**
 * Polls the Gemini Files API until a GIF-converted video file is ready.
 * Uses a shorter poll interval than full videos.
 *
 * @param {string} fileName
 * @returns {Promise<void>}
 * @throws {Error} on FAILED state or timeout
 */
export async function waitForGifProcessing(fileName) {
  let file     = await genAI.files.get({ name: fileName });
  let attempts = 0;

  while (file.state === FILE_STATES.PROCESSING && attempts < PROCESSING_TIMEOUTS.MAX_ATTEMPTS) {
    await sleep(PROCESSING_TIMEOUTS.GIF_WAIT_MS);
    file = await genAI.files.get({ name: fileName });
    attempts++;
  }

  if (file.state === FILE_STATES.FAILED) {
    throw new Error(`${ERROR_MESSAGES.PROCESSING_FAILED} (GIF → MP4)`);
  }

  if (file.state !== FILE_STATES.SUCCESS) {
    throw new Error(ERROR_MESSAGES.VIDEO_PROCESSING_TIMEOUT);
  }
}

// ============================================================================
// GIF CONVERSIONS
// ============================================================================

/**
 * Converts an animated GIF to an MP4 file via ffmpeg.
 * @param {string} filePath - source GIF path
 * @returns {Promise<string>} - path to the output MP4
 */
export async function convertGifToVideo(filePath) {
  const mp4FilePath = filePath.replace(/\.(gif|png|jpg|jpeg)$/i, '.mp4');

  await ffmpegPromise(
    ffmpeg(filePath)
      .outputOptions([
        '-movflags', VIDEO_CONVERSION_OPTIONS.MOVFLAGS,
        '-pix_fmt',  VIDEO_CONVERSION_OPTIONS.PIX_FMT,
        '-vf',       VIDEO_CONVERSION_OPTIONS.SCALE_FILTER
      ])
      .output(mp4FilePath)
  );

  return mp4FilePath;
}

/**
 * Extracts the first frame of a GIF as a PNG using sharp.
 * Used as a fallback when GIF-to-video conversion fails.
 * @param {string} filePath - source GIF path
 * @returns {Promise<string>} - path to the output PNG
 */
export async function convertGifToPng(filePath) {
  const sharp      = (await import('sharp')).default;
  const pngFilePath = filePath.replace(/\.(gif|png|jpg|jpeg)$/i, '.png');

  await sharp(filePath, { animated: false }).png().toFile(pngFilePath);
  return pngFilePath;
}

// ============================================================================
// IMAGE CONVERSION
// ============================================================================

/**
 * Converts any sharp-compatible image to PNG.
 * @param {string} filePath - source image path
 * @returns {Promise<string>} - path to the output PNG
 */
export async function convertImageToPng(filePath) {
  const sharp      = (await import('sharp')).default;
  const pngFilePath = filePath.replace(/\.[^.]+$/, '.png');

  await sharp(filePath).png().toFile(pngFilePath);
  return pngFilePath;
}

// ============================================================================
// AUDIO CONVERSION
// ============================================================================

/**
 * Converts an audio file to MP3 via ffmpeg.
 * @param {string} filePath - source audio path
 * @returns {Promise<string>} - path to the output MP3
 */
export async function convertAudioToMp3(filePath) {
  const mp3FilePath = filePath.replace(/\.[^.]+$/, '.mp3');

  await ffmpegPromise(
    ffmpeg(filePath)
      .toFormat(AUDIO_CONVERSION_OPTIONS.FORMAT)
      .audioCodec(AUDIO_CONVERSION_OPTIONS.CODEC)
      .audioBitrate(AUDIO_CONVERSION_OPTIONS.BITRATE)
      .output(mp3FilePath)
  );

  return mp3FilePath;
}

// ============================================================================
// VIDEO CONVERSION
// ============================================================================

/**
 * Converts a video file to MP4 via ffmpeg (H.264 + AAC).
 * @param {string} filePath - source video path
 * @returns {Promise<string>} - path to the output MP4
 */
export async function convertVideoToMp4(filePath) {
  const mp4FilePath = filePath.replace(/\.[^.]+$/, '.mp4');

  await ffmpegPromise(
    ffmpeg(filePath)
      .outputOptions([
        '-movflags', VIDEO_CONVERSION_OPTIONS.MOVFLAGS,
        '-pix_fmt',  VIDEO_CONVERSION_OPTIONS.PIX_FMT,
        '-vf',       VIDEO_CONVERSION_OPTIONS.SCALE_FILTER
      ])
      .videoCodec(VIDEO_CONVERSION_OPTIONS.VIDEO_CODEC)
      .audioCodec(VIDEO_CONVERSION_OPTIONS.AUDIO_CODEC)
      .output(mp4FilePath)
  );

  return mp4FilePath;
}
