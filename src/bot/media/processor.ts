import axios from 'axios';
import sharp from 'sharp';
import { Attachment } from 'discord.js';
import { BOT_LIMITS } from '@/config/constants.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MediaProcessor');

export interface ProcessedMedia {
  type: 'image' | 'text' | 'document' | 'other';
  mimeType: string;
  filename: string;
  size: number;
  inlineData?: {
    mimeType: string;
    data: string; // Base64 encoded
  };
  textContent?: string;
  error?: string;
}

export class MediaProcessor {
  /**
   * Downloads and processes a Discord attachment into an AI-ready payload
   */
  public static async processAttachment(attachment: Attachment): Promise<ProcessedMedia> {
    const filename = attachment.name;
    const contentType = attachment.contentType || 'application/octet-stream';
    const size = attachment.size;

    logger.debug(`Processing attachment: ${filename} (${contentType}, ${size} bytes)`);

    if (size > BOT_LIMITS.MAX_UPLOAD_SIZE_BYTES) {
      return {
        type: 'other',
        mimeType: contentType,
        filename,
        size,
        error: `Attachment ${filename} exceeds size limit of 25MB.`
      };
    }

    try {
      const response = await axios.get(attachment.url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: BOT_LIMITS.MAX_UPLOAD_SIZE_BYTES
      });

      const buffer = Buffer.from(response.data);

      // Handle Images
      if (contentType.startsWith('image/')) {
        return await MediaProcessor.processImage(buffer, contentType, filename, size);
      }

      // Handle Text/Markdown/Code/JSON/CSV
      if (
        contentType.startsWith('text/') ||
        filename.endsWith('.json') ||
        filename.endsWith('.csv') ||
        filename.endsWith('.md') ||
        filename.endsWith('.txt') ||
        filename.endsWith('.ts') ||
        filename.endsWith('.js')
      ) {
        const text = buffer.toString('utf-8');
        return {
          type: 'text',
          mimeType: contentType,
          filename,
          size,
          textContent: text.slice(0, BOT_LIMITS.MAX_TEXT_DISPLAY_CHARS)
        };
      }

      // Handle PDF
      if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
        return {
          type: 'document',
          mimeType: 'application/pdf',
          filename,
          size,
          inlineData: {
            mimeType: 'application/pdf',
            data: buffer.toString('base64')
          }
        };
      }

      return {
        type: 'other',
        mimeType: contentType,
        filename,
        size,
        error: `Unsupported media format: ${contentType}`
      };
    } catch (err: any) {
      logger.error(`Error processing attachment ${filename}`, err);
      return {
        type: 'other',
        mimeType: contentType,
        filename,
        size,
        error: `Failed to download or parse ${filename}: ${err.message}`
      };
    }
  }

  /**
   * Resizes large images if needed and encodes to base64
   */
  private static async processImage(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    size: number
  ): Promise<ProcessedMedia> {
    try {
      let finalBuffer = buffer;
      let finalMime = mimeType;

      // If image is larger than 4MB, downscale resolution to preserve bandwidth and latency
      if (size > 4 * 1024 * 1024) {
        finalBuffer = await sharp(buffer)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        finalMime = 'image/jpeg';
      }

      return {
        type: 'image',
        mimeType: finalMime,
        filename,
        size: finalBuffer.length,
        inlineData: {
          mimeType: finalMime,
          data: finalBuffer.toString('base64')
        }
      };
    } catch (err: any) {
      logger.warn(`Failed image optimization for ${filename}, using raw buffer`, err);
      return {
        type: 'image',
        mimeType,
        filename,
        size,
        inlineData: {
          mimeType,
          data: buffer.toString('base64')
        }
      };
    }
  }
}
