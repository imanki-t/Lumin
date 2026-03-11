/**
 * @fileoverview File type constants, classification helpers, and filename
 *               utilities. Pure functions — no I/O, no SDK calls.
 * @module modules/attachments/FileValidator
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const FILE_NAME_MAX_LENGTH = 100;

/** Timeouts used while polling Gemini file processing state. */
export const PROCESSING_TIMEOUTS = {
  VIDEO_WAIT_MS: 10_000,
  GIF_WAIT_MS:   5_000,
  MAX_ATTEMPTS:  60
};

/** ffmpeg options for video conversion. */
export const VIDEO_CONVERSION_OPTIONS = {
  MOVFLAGS:     'faststart',
  PIX_FMT:      'yuv420p',
  SCALE_FILTER: 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  VIDEO_CODEC:  'libx264',
  AUDIO_CODEC:  'aac'
};

/** ffmpeg options for audio conversion. */
export const AUDIO_CONVERSION_OPTIONS = {
  FORMAT:  'mp3',
  CODEC:   'libmp3lame',
  BITRATE: '192k'
};

/** MIME type string constants. */
export const MIME_TYPES = {
  PNG:         'image/png',
  JPEG:        'image/jpeg',
  WEBP:        'image/webp',
  GIF:         'image/gif',
  HEIF:        'image/heif',
  TIFF:        'image/tiff',
  BMP:         'image/bmp',
  MP4:         'video/mp4',
  QUICKTIME:   'video/quicktime',
  AVI:         'video/x-msvideo',
  WEBM:        'video/webm',
  MPEG_AUDIO:  'audio/mpeg',
  WAV:         'audio/wav',
  AAC:         'audio/aac',
  OGG:         'audio/ogg',
  FLAC:        'audio/flac',
  M4A:         'audio/mp4',
  PDF:         'application/pdf',
  TEXT_PLAIN:  'text/plain',
  OCTET_STREAM:'application/octet-stream',
  SVG:         'image/svg+xml',
  AVIF:        'image/avif',
  ICON:        'image/x-icon',
  PSD:         'image/vnd.adobe.photoshop',
  WMA:         'audio/x-ms-wma',
  AMR:         'audio/amr',
  MIDI:        'audio/midi',
  REALAUDIO:   'audio/x-realaudio',
  MATROSKA:    'video/x-matroska',
  OGV:         'video/ogg',
  MP2T:        'video/mp2t',
  MSWORD:      'application/msword',
  DOCX:        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  EXCEL:       'application/vnd.ms-excel',
  XLSX:        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV:         'text/csv',
  TSV:         'text/tab-separated-values',
  PPTX:        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  RTF:         'application/rtf',
  HTML:        'text/html',
  MARKDOWN:    'text/markdown',
  JSON:        'application/json',
  XML:         'application/xml',
  PYTHON:      'text/x-python',
  JAVA:        'text/x-java',
  JAVASCRIPT:  'text/javascript',
  CSS:         'text/css',
  SQL:         'application/x-sql',
  ZIP:         'application/zip',
  RAR:         'application/x-rar-compressed',
  SEVEN_Z:     'application/x-7z-compressed',
  TAR:         'application/x-tar',
  GZIP:        'application/gzip',
  EXECUTABLE:  'application/x-executable',
  MSDOWNLOAD:  'application/x-msdownload',
  PE:          'application/vnd.microsoft.portable-executable',
  ISO:         'application/iso9660-image'
};

/** File extension sets by category and handling strategy. */
export const FILE_EXTENSIONS = {
  IMAGES: {
    DIRECT_UPLOAD: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heif', '.tiff', '.bmp'],
    CONVERTIBLE:   ['.svg', '.avif', '.ico', '.psd', '.eps', '.raw', '.cr2', '.nef']
  },
  VIDEO: {
    DIRECT_UPLOAD: ['.mp4', '.mov', '.mpeg', '.mpg', '.webm', '.avi', '.wmv', '.3gpp', '.flv'],
    CONVERTIBLE:   ['.mkv', '.vob', '.ogv', '.ts', '.m2ts', '.divx']
  },
  AUDIO: {
    DIRECT_UPLOAD: ['.mp3', '.wav', '.aiff', '.aac', '.ogg', '.flac', '.m4a', '.opus'],
    CONVERTIBLE:   ['.wma', '.amr', '.mid', '.midi', '.ra']
  },
  DOCUMENTS: {
    PDF:    ['.pdf'],
    TEXT:   ['.txt'],
    OFFICE: ['.doc', '.docx', '.xls', '.xlsx', '.csv', '.tsv', '.pptx', '.rtf'],
    MARKUP: ['.html', '.xml', '.md'],
    CODE: [
      '.py', '.java', '.js', '.css', '.json', '.sql', '.log', '.c', '.cpp', '.h',
      '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.sh',
      '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf'
    ]
  },
  UNSUPPORTED: {
    ARCHIVES:    ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
    EXECUTABLES: ['.exe', '.dll', '.bin', '.dmg', '.pkg', '.deb', '.rpm', '.msi', '.apk', '.jar'],
    DATABASES:   ['.db', '.sqlite', '.mdb', '.accdb'],
    DISK_IMAGES: ['.iso', '.img']
  }
};

/** Human-readable file type labels used in metadata strings. */
export const FILE_TYPE_DESCRIPTIONS = {
  IMAGE:       'Image',
  VIDEO:       'Video',
  AUDIO:       'Audio',
  PDF:         'PDF Document',
  TEXT:        'Text File',
  WORD:        'Word Document',
  SPREADSHEET: 'Spreadsheet',
  POWERPOINT:  'PowerPoint Presentation',
  MARKUP:      'Markup Document',
  CODE:        'Code File',
  CONFIG:      'Text Configuration File',
  DOCUMENT:    'Document'
};

/** Metadata messages appended to converted files. */
export const CONVERSION_MESSAGES = {
  GIF_TO_VIDEO:       'Animated GIF converted to video',
  STICKER_TO_VIDEO:   'Animated Sticker converted to video',
  EMOJI_TO_VIDEO:     'Animated Emoji converted to video',
  GIF_TO_PNG:         'Static frame from GIF',
  STICKER_TO_PNG:     'Static frame from Animated Sticker',
  EMOJI_TO_PNG:       'Static frame from Animated Emoji',
  IMAGE_CONVERTED:    'Image converted from',
  AUDIO_CONVERTED:    'Audio converted from',
  VIDEO_CONVERTED:    'Video converted from',
  DOCUMENT_EXTRACTED: 'extracted to text'
};

/** Error message strings. */
export const ERROR_MESSAGES = {
  UNSUPPORTED:             'Unsupported File Type',
  UNSUPPORTED_DESC:        'This file format cannot be processed. Supported formats include: images, videos, audio, PDFs, text files, and office documents.',
  CONVERSION_FAILED:       'Failed to convert',
  EXTRACTION_FAILED:       'Failed to extract text from',
  UNKNOWN_FORMAT:          'Unknown file format',
  NO_FILE_NAME:            'Unable to extract file name from upload result',
  VIDEO_PROCESSING_FAILED: 'Video processing failed',
  VIDEO_PROCESSING_TIMEOUT:'Video processing timed out after maximum polling attempts',
  PROCESSING_FAILED:       'Video processing failed for'
};

/** Gemini file state strings. */
export const FILE_STATES = {
  PROCESSING: 'PROCESSING',
  FAILED:     'FAILED',
  SUCCESS:    'ACTIVE'
};

/** Extension → MIME type fallback map (used when content-type is generic). */
export const MIME_TYPE_MAP = {
  '.png':  MIME_TYPES.PNG,
  '.jpg':  MIME_TYPES.JPEG,
  '.jpeg': MIME_TYPES.JPEG,
  '.webp': MIME_TYPES.WEBP,
  '.gif':  MIME_TYPES.GIF,
  '.heif': MIME_TYPES.HEIF,
  '.tiff': MIME_TYPES.TIFF,
  '.bmp':  MIME_TYPES.BMP,
  '.mp4':  MIME_TYPES.MP4,
  '.mov':  MIME_TYPES.QUICKTIME,
  '.avi':  MIME_TYPES.AVI,
  '.webm': MIME_TYPES.WEBM,
  '.mp3':  MIME_TYPES.MPEG_AUDIO,
  '.wav':  MIME_TYPES.WAV,
  '.aac':  MIME_TYPES.AAC,
  '.ogg':  MIME_TYPES.OGG,
  '.flac': MIME_TYPES.FLAC,
  '.m4a':  MIME_TYPES.M4A,
  '.pdf':  MIME_TYPES.PDF,
  '.txt':  MIME_TYPES.TEXT_PLAIN
};

// Flatten once at module load for O(1) lookups
const _ALL_UNSUPPORTED = new Set([
  ...FILE_EXTENSIONS.UNSUPPORTED.ARCHIVES,
  ...FILE_EXTENSIONS.UNSUPPORTED.EXECUTABLES,
  ...FILE_EXTENSIONS.UNSUPPORTED.DATABASES,
  ...FILE_EXTENSIONS.UNSUPPORTED.DISK_IMAGES
]);

const _ALL_DIRECT = new Set([
  ...FILE_EXTENSIONS.IMAGES.DIRECT_UPLOAD,
  ...FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD,
  ...FILE_EXTENSIONS.AUDIO.DIRECT_UPLOAD,
  ...FILE_EXTENSIONS.DOCUMENTS.PDF,
  ...FILE_EXTENSIONS.DOCUMENTS.TEXT
]);

const _ALL_EXTRACTABLE = new Set([
  ...FILE_EXTENSIONS.DOCUMENTS.OFFICE,
  ...FILE_EXTENSIONS.DOCUMENTS.MARKUP,
  ...FILE_EXTENSIONS.DOCUMENTS.CODE
]);

// ============================================================================
// CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Returns true if the file extension is in the unsupported (blocked) set.
 * @param {string} fileExtension - lowercase extension including dot
 */
export function isUnsupportedFile(fileExtension) {
  return _ALL_UNSUPPORTED.has(fileExtension);
}

/**
 * Returns true if the file can be uploaded directly to the Gemini Files API
 * without any conversion.
 * @param {string} fileExtension
 */
export function canUploadDirectly(fileExtension) {
  return _ALL_DIRECT.has(fileExtension);
}

/**
 * Returns true if the image needs to be converted to PNG before upload.
 * @param {string} fileExtension
 */
export function needsImageConversion(fileExtension) {
  return FILE_EXTENSIONS.IMAGES.CONVERTIBLE.includes(fileExtension);
}

/**
 * Returns true if the audio needs to be converted to MP3 before upload.
 * @param {string} fileExtension
 */
export function needsAudioConversion(fileExtension) {
  return FILE_EXTENSIONS.AUDIO.CONVERTIBLE.includes(fileExtension);
}

/**
 * Returns true if the video needs to be converted to MP4 before upload.
 * @param {string} fileExtension
 */
export function needsVideoConversion(fileExtension) {
  return FILE_EXTENSIONS.VIDEO.CONVERTIBLE.includes(fileExtension);
}

/**
 * Returns true if the file is a document that needs text extraction.
 * @param {string} fileExtension
 */
export function needsTextExtraction(fileExtension) {
  return _ALL_EXTRACTABLE.has(fileExtension);
}

/**
 * Returns true if the attachment is animated GIF / sticker / emoji content
 * that should be converted to video (or fallback PNG).
 * @param {{ isSticker?: boolean, isAnimated?: boolean, isEmoji?: boolean }} attachment
 * @param {string} contentType
 * @param {string} fileExtension
 */
export function isAnimatedContent(attachment, contentType, fileExtension) {
  const isGif           = contentType === MIME_TYPES.GIF || fileExtension === '.gif';
  const isAnimatedSticker = attachment.isSticker && attachment.isAnimated;
  const isAnimatedEmoji   = attachment.isEmoji   && attachment.isAnimated;
  return (isGif || isAnimatedSticker || isAnimatedEmoji) && !contentType.includes('video');
}

// ============================================================================
// TYPE RESOLUTION
// ============================================================================

/**
 * Returns a human-readable file type label for use in metadata strings.
 * @param {string} fileExtension
 * @param {string} mimeType
 * @returns {string}
 */
export function determineFileType(fileExtension, mimeType) {
  if (FILE_EXTENSIONS.IMAGES.DIRECT_UPLOAD.includes(fileExtension)) return FILE_TYPE_DESCRIPTIONS.IMAGE;
  if (FILE_EXTENSIONS.VIDEO.DIRECT_UPLOAD.includes(fileExtension))  return FILE_TYPE_DESCRIPTIONS.VIDEO;
  if (FILE_EXTENSIONS.AUDIO.DIRECT_UPLOAD.includes(fileExtension))  return FILE_TYPE_DESCRIPTIONS.AUDIO;
  if (FILE_EXTENSIONS.DOCUMENTS.PDF.includes(fileExtension))        return FILE_TYPE_DESCRIPTIONS.PDF;
  if (FILE_EXTENSIONS.DOCUMENTS.TEXT.includes(fileExtension))       return FILE_TYPE_DESCRIPTIONS.TEXT;
  return 'File';
}

/**
 * Returns a human-readable document type label for office/markup/code files.
 * @param {string} fileExtension
 * @returns {string}
 */
export function determineDocumentType(fileExtension) {
  if (['.doc', '.docx', '.rtf'].includes(fileExtension))          return FILE_TYPE_DESCRIPTIONS.WORD;
  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(fileExtension))  return FILE_TYPE_DESCRIPTIONS.SPREADSHEET;
  if (fileExtension === '.pptx')                                  return FILE_TYPE_DESCRIPTIONS.POWERPOINT;
  if (['.html', '.xml'].includes(fileExtension))                  return FILE_TYPE_DESCRIPTIONS.MARKUP;
  if (FILE_EXTENSIONS.DOCUMENTS.CODE.includes(fileExtension))    return FILE_TYPE_DESCRIPTIONS.CODE;
  if (['.md', '.log', '.yml', '.yaml', '.ini', '.cfg', '.conf'].includes(fileExtension)) return FILE_TYPE_DESCRIPTIONS.CONFIG;
  return FILE_TYPE_DESCRIPTIONS.DOCUMENT;
}

/**
 * Resolves the MIME type to use for a Gemini upload.
 * Falls back to extension-based map when content-type is generic/missing.
 * @param {string} contentType
 * @param {string} fileExtension
 * @returns {string}
 */
export function resolveMimeType(contentType, fileExtension) {
  if (!contentType || contentType === MIME_TYPES.OCTET_STREAM) {
    return MIME_TYPE_MAP[fileExtension] || MIME_TYPES.OCTET_STREAM;
  }
  return contentType;
}

// ============================================================================
// FILENAME UTILITIES
// ============================================================================

/**
 * Sanitizes a raw filename: lowercase, alphanumeric/dot/dash only, max length.
 * @param {string} fileName
 * @returns {string}
 */
export function sanitizeFileName(fileName) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, FILE_NAME_MAX_LENGTH);
}

/**
 * Generates a unique temp filename scoped to user + interaction to avoid collisions.
 * @param {string} userId
 * @param {string} interactionId
 * @param {string} sanitizedName
 * @returns {string}
 */
export function generateUniqueFilename(userId, interactionId, sanitizedName) {
  return `${userId}-${interactionId}-${Date.now()}-${sanitizedName}`;
}
