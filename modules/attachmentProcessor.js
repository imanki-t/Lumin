import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { genAI, TEMP_DIR, createPartFromUri } from '../botManager.js';
import { delay } from '../tools/others.js';

const FILE_NAME_MAX_LENGTH = 100;

const PROCESSING_TIMEOUTS = {
  VIDEO_WAIT_MS: 10000,
  GIF_WAIT_MS: 5000,
  MAX_ATTEMPTS: 60
};

const VIDEO_CONVERSION_OPTIONS = {
  MOVFLAGS: 'faststart',
  PIX_FMT: 'yuv420p',
  SCALE_FILTER: 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  VIDEO_CODEC: 'libx264',
  AUDIO_CODEC: 'aac'
};

const AUDIO_CONVERSION_OPTIONS = {
  FORMAT: 'mp3',
  CODEC: 'libmp3lame',
  BITRATE: '192k'
};

const MIME_TYPES = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  WEBP: 'image/webp',
  GIF: 'image/gif',
  HEIF: 'image/heif',
  TIFF: 'image/tiff',
  BMP: 'image/bmp',
  MP4: 'video/mp4',
  QUICKTIME: 'video/quicktime',
  AVI: 'video/x-msvideo',
  WEBM: 'video/webm',
  MPEG_AUDIO: 'audio/mpeg',
  WAV: 'audio/wav',
  AAC: 'audio/aac',
  OGG: 'audio/ogg',
  FLAC: 'audio/flac',
  M4A: 'audio/mp4',
  PDF: 'application/pdf',
  TEXT_PLAIN: 'text/plain',
  OCTET_STREAM: 'application/octet-stream',
  SVG: 'image/svg+xml',
  AVIF: 'image/avif',
  ICON: 'image/x-icon',
  PSD: 'image/vnd.adobe.photoshop',
  WMA: 'audio/x-ms-wma',
  AMR: 'audio/amr',
  MIDI: 'audio/midi',
  REALAUDIO: 'audio/x-realaudio',
  MATROSKA: 'video/x-matroska',
  OGV: 'video/ogg',
  MP2T: 'video/mp2t',
  MSWORD: 'application/msword',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  EXCEL: 'application/vnd.ms-excel',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  TSV: 'text/tab-separated-values',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  RTF: 'application/rtf',
  HTML: 'text/html',
  MARKDOWN: 'text/markdown',
  JSON: 'application/json',
  XML: 'application/xml',
  PYTHON: 'text/x-python',
  JAVA: 'text/x-java',
  JAVASCRIPT: 'text/javascript',
  CSS: 'text/css',
  SQL: 'application/x-sql',
  ZIP: 'application/zip',
  RAR: 'application/x-rar-compressed',
  SEVEN_Z: 'application/x-7z-compressed',
  TAR: 'application/x-tar',
  GZIP: 'application/gzip',
  EXECUTABLE: 'application/x-executable',
  MSDOWNLOAD: 'application/x-msdownload',
  PE: 'application/vnd.microsoft.portable-executable',
  ISO: 'application/iso9660-image'
};

const FILE_EXTENSIONS = {
  IMAGES: {
    DIRECT_UPLOAD: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heif', '.tiff', '.bmp'],
    CONVERTIBLE: ['.svg', '.avif', '.ico', '.psd', '.eps', '.raw', '.cr2', '.nef']
  },
  VIDEO: {
    DIRECT_UPLOAD: ['.mp4', '.mov', '.mpeg', '.mpg', '.webm', '.avi', '.wmv', '.3gpp', '.flv'],
    CONVERTIBLE: ['.mkv', '.vob', '.ogv', '.ts', '.m2ts', '.divx']
  },
  AUDIO: {
    DIRECT_UPLOAD: ['.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a', '.opus'],
    CONVERTIBLE: ['.wma', '.amr', '.mid', '.midi', '.ra']
  },
  DOCUMENTS: {
    PDF: ['.pdf'],
    TEXT: ['.txt'],
    OFFICE: ['.doc', '.docx', '.xls', '.xlsx', '.csv', '.tsv', '.pptx', '.rtf'],
    MARKUP: ['.html', '.xml', '.md'],
    CODE: ['.py', '.java', '.js', '.css', '.json', '.sql', '.log', '.c', '.cpp', '.h', 
           '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.sh', 
           '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf']
  },
  UNSUPPORTED: {
    ARCHIVES: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
    EXECUTABLES: ['.exe', '.dll', '.bin', '.dmg', '.pkg', '.deb', '.rpm', '.msi', '.apk', '.jar'],
    DATABASES: ['.db', '.sqlite', '.mdb', '.accdb'],
    DISK_IMAGES: ['.iso', '.img']
  }
};

const FILE_TYPE_DESCRIPTIONS = {
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  PDF: 'PDF Document',
  TEXT: 'Text File',
  WORD: 'Word Document',
  SPREADSHEET: 'Spreadsheet',
  POWERPOINT: 'PowerPoint Presentation',
  MARKUP: 'Markup Document',
  CODE: 'Code File',
  CONFIG: 'Text Configuration File',
  DOCUMENT: 'Document'
};

const CONVERSION_MESSAGES = {
  GIF_TO_VIDEO: 'Animated GIF converted to video',
  STICKER_TO_VIDEO: 'Animated Sticker converted to video',
  EMOJI_TO_VIDEO: 'Animated Emoji converted to video',
  GIF_TO_PNG: 'Static frame from GIF',
  STICKER_TO_PNG: 'Static frame from Animated Sticker',
  EMOJI_TO_PNG: 'Static frame from Animated Emoji',
  IMAGE_CONVERTED: 'Image converted from',
  AUDIO_CONVERTED: 'Audio converted from',
  VIDEO_CONVERTED: 'Video converted from',
  DOCUMENT_EXTRACTED: 'extracted to text'
};

const ERROR_MESSAGES = {
  UNSUPPORTED: 'Unsupported File Type',
  UNSUPPORTED_DESC: 'This file format cannot be processed. Supported formats include: images, videos, audio, PDFs, text files, and office documents.',
  CONVERSION_FAILED: 'Failed to convert',
  EXTRACTION_FAILED: 'Failed to extract text from',
  UNKNOWN_FORMAT: 'Unknown file format',
  NO_FILE_NAME: 'Unable to extract file name from upload result',
  VIDEO_PROCESSING_FAILED: 'Video processing failed',
  PROCESSING_FAILED: 'Video processing failed for'
};

const FILE_STATES = {
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  SUCCESS: 'ACTIVE'
};

const MIME_TYPE_MAP = {
  '.png': MIME_TYPES.PNG,
  '.jpg': MIME_TYPES.JPEG,
  '.jpeg': MIME_TYPES.JPEG,
  '.webp': MIME_TYPES.WEBP,
  '.gif': MIME_TYPES.GIF,
  '.heif': MIME_TYPES.HEIF,
  '.tiff': MIME_TYPES.TIFF,
  '.bmp': MIME_TYPES.BMP,
  '.mp4': MIME_TYPES.MP4,
  '.mov': MIME_TYPES.QUICKTIME,
  '.avi': MIME_TYPES.AVI,
  '.webm': MIME_TYPES.WEBM,
  '.mp3': MIME_TYPES.MPEG_AUDIO,
  '.wav': MIME_TYPES.WAV,
  '.aac': MIME_TYPES.AAC,
  '.ogg': MIME_TYPES.OGG,
  '.flac': MIME_TYPES.FLAC,
  '.m4a': MIME_TYPES.M4A,
  '.pdf': MIME_TYPES.PDF,
  '.txt': MIME_TYPES.TEXT_PLAIN
};

function sanitizeFileName(fileName) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILE_NAME_MAX_LENGTH);
}

function generateUniqueFilename(userId, interactionId, sanitizedName) {
  return `${userId}-${interactionId}-${Date.now()}-${sanitizedName}`;
}

function getFilePath(tempDir, uniqueFilename) {
  return path.join(tempDir, uniqueFilename);
}

async function downloadFile(url, filePath) {
  const writer = createWriteStream(filePath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function cleanupFiles(...filePaths) {
  await Promise.all(
    filePaths.map(fp => fs.unlink(fp).catch(() => {}))
  );
}

function isUnsupportedFile(fileExtension, contentType) {
  const allUnsupported = [
    ...FILE_EXTENSIONS.UNSUPPORTED.ARCHIVES,
    ...FILE_EXTENSIONS.UNSUPPORTED.EXECUTABLES,
    ...FILE_EXTENSIONS.UNSUPPORTED.DATABASES,
    ...FILE_EXTENSIONS.UNSUPPORTED.DISK_IMAGES
  ];
  
  return allUnsupported.includes(fileExtension);
}

function canUploadDirectly(fileExtension, contentType) {
  const directUploadExtensions = [
    ...FILE_EXTENSIONS.IMAGES.DIRECT_UPLOAD,
    ...FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD,
    ...FILE_EXTENSIONS.AUDIO.DIRECT_UPLOAD,
    ...FILE_EXTENSIONS.DOCUMENTS.PDF,
    ...FILE_EXTENSIONS.DOCUMENTS.TEXT
  ];
  
  return directUploadExtensions.includes(fileExtension);
}

function needsImageConversion(fileExtension, contentType) {
  return FILE_EXTENSIONS.IMAGES.CONVERTIBLE.includes(fileExtension);
}

function needsAudioConversion(fileExtension, contentType) {
  return FILE_EXTENSIONS.AUDIO.CONVERTIBLE.includes(fileExtension);
}

function needsVideoConversion(fileExtension, contentType) {
  return FILE_EXTENSIONS.VIDEO.CONVERTIBLE.includes(fileExtension);
}

function needsTextExtraction(fileExtension, contentType) {
  const extractableExtensions = [
    ...FILE_EXTENSIONS.DOCUMENTS.OFFICE,
    ...FILE_EXTENSIONS.DOCUMENTS.MARKUP,
    ...FILE_EXTENSIONS.DOCUMENTS.CODE
  ];
  
  return extractableExtensions.includes(fileExtension);
}

function isAnimatedContent(attachment, contentType, fileExtension) {
  const isGif = contentType === MIME_TYPES.GIF || fileExtension === '.gif';
  const isAnimatedSticker = attachment.isSticker && attachment.isAnimated;
  const isAnimatedEmoji = attachment.isEmoji && attachment.isAnimated;
  
  return (isGif || isAnimatedSticker || isAnimatedEmoji) && !contentType.includes('video');
}

function determineFileType(fileExtension, mimeType) {
  if (FILE_EXTENSIONS.IMAGES.DIRECT_UPLOAD.includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.IMAGE;
  }
  if (FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD.includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.VIDEO;
  }
  if (FILE_EXTENSIONS.AUDIO.DIRECT_UPLOAD.includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.AUDIO;
  }
  if (FILE_EXTENSIONS.DOCUMENTS.PDF.includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.PDF;
  }
  if (FILE_EXTENSIONS.DOCUMENTS.TEXT.includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.TEXT;
  }
  return 'File';
}

function determineDocumentType(fileExtension) {
  if (['.doc', '.docx', '.rtf'].includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.WORD;
  }
  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.SPREADSHEET;
  }
  if (fileExtension === '.pptx') {
    return FILE_TYPE_DESCRIPTIONS.POWERPOINT;
  }
  if (['.html', '.xml'].includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.MARKUP;
  }
  if (FILE_EXTENSIONS.DOCUMENTS.CODE.some(ext => ext === fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.CODE;
  }
  if (['.md', '.log', '.yml', '.yaml', '.ini', '.cfg', '.conf'].includes(fileExtension)) {
    return FILE_TYPE_DESCRIPTIONS.CONFIG;
  }
  return FILE_TYPE_DESCRIPTIONS.DOCUMENT;
}

function resolveMimeType(contentType, fileExtension) {
  if (!contentType || contentType === MIME_TYPES.OCTET_STREAM) {
    return MIME_TYPE_MAP[fileExtension] || MIME_TYPES.OCTET_STREAM;
  }
  return contentType;
}

async function waitForVideoProcessing(fileName) {
  let file = await genAI.files.get({ name: fileName });
  let attempts = 0;
  
  while (file.state === FILE_STATES.PROCESSING && attempts < PROCESSING_TIMEOUTS.MAX_ATTEMPTS) {
    await delay(PROCESSING_TIMEOUTS.VIDEO_WAIT_MS);
    file = await genAI.files.get({ name: fileName });
    attempts++;
  }
  
  if (file.state === FILE_STATES.FAILED) {
    throw new Error(ERROR_MESSAGES.VIDEO_PROCESSING_FAILED);
  }
}

async function convertGifToVideo(filePath, sanitizedFileName) {
  const mp4FilePath = filePath.replace(/\.(gif|png|jpg|jpeg)$/i, '.mp4');
  
  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        '-movflags', VIDEO_CONVERSION_OPTIONS.MOVFLAGS,
        '-pix_fmt', VIDEO_CONVERSION_OPTIONS.PIX_FMT,
        '-vf', VIDEO_CONVERSION_OPTIONS.SCALE_FILTER
      ])
      .output(mp4FilePath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
  
  return mp4FilePath;
}

async function convertGifToPng(filePath) {
  const sharp = (await import('sharp')).default;
  const pngFilePath = filePath.replace(/\.(gif|png|jpg|jpeg)$/i, '.png');
  
  await sharp(filePath, { animated: false })
    .png()
    .toFile(pngFilePath);
  
  return pngFilePath;
}

async function convertImageToPng(filePath) {
  const sharp = (await import('sharp')).default;
  const pngFilePath = filePath.replace(/\.[^.]+$/, '.png');
  
  await sharp(filePath)
    .png()
    .toFile(pngFilePath);
  
  return pngFilePath;
}

async function convertAudioToMp3(filePath) {
  const mp3FilePath = filePath.replace(/\.[^.]+$/, '.mp3');
  
  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .toFormat(AUDIO_CONVERSION_OPTIONS.FORMAT)
      .audioCodec(AUDIO_CONVERSION_OPTIONS.CODEC)
      .audioBitrate(AUDIO_CONVERSION_OPTIONS.BITRATE)
      .output(mp3FilePath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
  
  return mp3FilePath;
}

async function convertVideoToMp4(filePath) {
  const mp4FilePath = filePath.replace(/\.[^.]+$/, '.mp4');
  
  await new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        '-movflags', VIDEO_CONVERSION_OPTIONS.MOVFLAGS,
        '-pix_fmt', VIDEO_CONVERSION_OPTIONS.PIX_FMT,
        '-vf', VIDEO_CONVERSION_OPTIONS.SCALE_FILTER
      ])
      .videoCodec(VIDEO_CONVERSION_OPTIONS.VIDEO_CODEC)
      .audioCodec(VIDEO_CONVERSION_OPTIONS.AUDIO_CODEC)
      .output(mp4FilePath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
  
  return mp4FilePath;
}

async function processAnimatedContent(filePath, sanitizedFileName, attachment) {
  try {
    const mp4FilePath = await convertGifToVideo(filePath, sanitizedFileName);
    
    const uploadResult = await genAI.files.upload({
      file: mp4FilePath,
      config: {
        mimeType: MIME_TYPES.MP4,
        displayName: sanitizedFileName.replace(/\.gif$/i, '.mp4'),
      }
    });

    const name = uploadResult.name;
    if (!name) {
      throw new Error(ERROR_MESSAGES.NO_FILE_NAME);
    }

    let file = await genAI.files.get({ name: name });
    let attempts = 0;
    
    while (file.state === FILE_STATES.PROCESSING && attempts < PROCESSING_TIMEOUTS.MAX_ATTEMPTS) {
      await delay(PROCESSING_TIMEOUTS.GIF_WAIT_MS);
      file = await genAI.files.get({ name: name });
      attempts++;
    }
    
    if (file.state === FILE_STATES.FAILED) {
      throw new Error(`${ERROR_MESSAGES.PROCESSING_FAILED} ${sanitizedFileName}.`);
    }

    await cleanupFiles(filePath, mp4FilePath);
    
    let metadata = '';
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
    const pngFilePath = await convertGifToPng(filePath);
    
    const uploadResult = await genAI.files.upload({
      file: pngFilePath,
      config: {
        mimeType: MIME_TYPES.PNG,
        displayName: sanitizedFileName.replace(/\.(gif|png|jpg|jpeg)$/i, '.png'),
      }
    });
    
    await cleanupFiles(filePath, pngFilePath);
    
    let fallbackMetadata = '';
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

async function processDirectUpload(filePath, sanitizedFileName, contentType, fileExtension, attachment) {
  const mimeType = resolveMimeType(contentType, fileExtension);
  
  const uploadResult = await genAI.files.upload({
    file: filePath,
    config: {
      mimeType: mimeType,
      displayName: sanitizedFileName,
    }
  });

  const name = uploadResult.name;
  if (!name) {
    throw new Error(ERROR_MESSAGES.NO_FILE_NAME);
  }

  if (FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD.includes(fileExtension)) {
    await waitForVideoProcessing(name);
  }

  await cleanupFiles(filePath);
  
  const fileTypeDescription = determineFileType(fileExtension, mimeType);
  
  return [
    { text: `[${fileTypeDescription} uploaded: ${sanitizedFileName} (${mimeType})]` },
    createPartFromUri(uploadResult.uri, uploadResult.mimeType)
  ];
}

async function processImageConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const pngFilePath = await convertImageToPng(filePath);
  
  const uploadResult = await genAI.files.upload({
    file: pngFilePath,
    config: {
      mimeType: MIME_TYPES.PNG,
      displayName: sanitizedFileName.replace(/\.[^.]+$/, '.png'),
    }
  });

  await cleanupFiles(filePath, pngFilePath);
  
  return [
    { text: `[${CONVERSION_MESSAGES.IMAGE_CONVERTED} ${fileExtension.toUpperCase()} to PNG: ${attachment.name} (${MIME_TYPES.PNG})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.PNG)
  ];
}

async function processAudioConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const mp3FilePath = await convertAudioToMp3(filePath);
  
  const uploadResult = await genAI.files.upload({
    file: mp3FilePath,
    config: {
      mimeType: MIME_TYPES.MPEG_AUDIO,
      displayName: sanitizedFileName.replace(/\.[^.]+$/, '.mp3'),
    }
  });

  await cleanupFiles(filePath, mp3FilePath);
  
  return [
    { text: `[${CONVERSION_MESSAGES.AUDIO_CONVERTED} ${fileExtension.toUpperCase()} to MP3: ${attachment.name} (${MIME_TYPES.MPEG_AUDIO})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.MPEG_AUDIO)
  ];
}

async function processVideoConversion(filePath, sanitizedFileName, fileExtension, attachment) {
  const mp4FilePath = await convertVideoToMp4(filePath);
  
  const uploadResult = await genAI.files.upload({
    file: mp4FilePath,
    config: {
      mimeType: MIME_TYPES.MP4,
      displayName: sanitizedFileName.replace(/\.[^.]+$/, '.mp4'),
    }
  });

  const name = uploadResult.name;
  await waitForVideoProcessing(name);

  await cleanupFiles(filePath, mp4FilePath);
  
  return [
    { text: `[${CONVERSION_MESSAGES.VIDEO_CONVERTED} ${fileExtension.toUpperCase()} to MP4: ${attachment.name} (${MIME_TYPES.MP4})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.MP4)
  ];
}

async function processTextExtraction(attachment, filePath, sanitizedFileName, fileExtension, uniqueTempFilename) {
  const { downloadAndReadFile } = await import('./utils.js');
  const fileContent = await downloadAndReadFile(attachment.url, fileExtension);
  
  const txtFileName = sanitizedFileName.replace(/\.[^.]+$/, '.txt');
  const txtFilePath = path.join(TEMP_DIR, `extracted-${uniqueTempFilename}.txt`);
  
  await fs.writeFile(txtFilePath, fileContent, 'utf8');
  
  const uploadResult = await genAI.files.upload({
    file: txtFilePath,
    config: {
      mimeType: MIME_TYPES.TEXT_PLAIN,
      displayName: txtFileName,
    }
  });

  await cleanupFiles(txtFilePath);
  
  const originalType = determineDocumentType(fileExtension);
  
  return [
    { text: `[${originalType} ${CONVERSION_MESSAGES.DOCUMENT_EXTRACTED}: ${attachment.name} (converted to ${MIME_TYPES.TEXT_PLAIN})]` },
    createPartFromUri(uploadResult.uri, MIME_TYPES.TEXT_PLAIN)
  ];
}

export async function processAttachment(attachment, userId, interactionId) {
  const contentType = (attachment.contentType || "").toLowerCase();
  const fileExtension = path.extname(attachment.name).toLowerCase();

  if (isUnsupportedFile(fileExtension, contentType)) {
    console.warn(`Unsupported file type: ${attachment.name} (${contentType})`);
    return {
      text: `\n\n[❌ ${ERROR_MESSAGES.UNSUPPORTED}: ${attachment.name}]\n${ERROR_MESSAGES.UNSUPPORTED_DESC}`
    };
  }

  const sanitizedFileName = sanitizeFileName(attachment.name);
  const uniqueTempFilename = generateUniqueFilename(userId, interactionId, sanitizedFileName);
  const filePath = getFilePath(TEMP_DIR, uniqueTempFilename);

  try {
    if (canUploadDirectly(fileExtension, contentType)) {
      await downloadFile(attachment.url, filePath);
      
      if (isAnimatedContent(attachment, contentType, fileExtension)) {
        return await processAnimatedContent(filePath, sanitizedFileName, attachment);
      }
      
      return await processDirectUpload(filePath, sanitizedFileName, contentType, fileExtension, attachment);
    }

    if (needsImageConversion(fileExtension, contentType)) {
      await downloadFile(attachment.url, filePath);
      return await processImageConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    if (needsAudioConversion(fileExtension, contentType)) {
      await downloadFile(attachment.url, filePath);
      return await processAudioConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    if (needsVideoConversion(fileExtension, contentType)) {
      await downloadFile(attachment.url, filePath);
      return await processVideoConversion(filePath, sanitizedFileName, fileExtension, attachment);
    }

    if (needsTextExtraction(fileExtension, contentType)) {
      return await processTextExtraction(attachment, filePath, sanitizedFileName, fileExtension, uniqueTempFilename);
    }

    console.warn(`Unhandled file type: ${attachment.name} (${contentType})`);
    return {
      text: `\n\n[⚠️ ${ERROR_MESSAGES.UNKNOWN_FORMAT}: ${attachment.name}]`
    };
    
  } catch (error) {
    console.error(`Error processing ${attachment.name}:`, error);
    await cleanupFiles(filePath);
    
    const errorType = error.message.includes('convert') ? ERROR_MESSAGES.CONVERSION_FAILED : 
                      error.message.includes('extract') ? ERROR_MESSAGES.EXTRACTION_FAILED : 
                      'Processing error';
    
    return {
      text: `\n\n[❌ ${errorType}: ${attachment.name}]`
    };
  }
}
