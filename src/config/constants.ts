/**
 * Application Constants and System Limits
 */

export const AI_MODELS = {
  FLASH: 'gemini-3.5-flash',
  FLASH_LITE: 'gemini-3.5-flash-lite',
  GEMMA_9B: 'gemma-2-9b',
  GEMMA_27B: 'gemma-2-27b',
  EMBEDDING: 'gemini-embedding-2'
} as const;

export type AIModelType = (typeof AI_MODELS)[keyof typeof AI_MODELS];

export const MEMORY_CONFIG = {
  /** Maximum number of raw conversation turns kept in active Redis sliding window */
  SLIDING_WINDOW_TURNS: 12,
  /** TTL for active conversation buffer in seconds (4 hours) */
  WINDOW_TTL_SECONDS: 14400,
  /** Message threshold that triggers background rolling summarization */
  SUMMARY_TRIGGER_COUNT: 10,
  /** Maximum tokens allocated for sliding window context */
  MAX_WINDOW_TOKENS: 4096,
  /** Maximum vector search results for explicit document RAG */
  MAX_RAG_CHUNKS: 5,
  /** Minimum similarity score threshold for vector retrieval */
  RAG_SIMILARITY_THRESHOLD: 0.72
} as const;

export const BOT_LIMITS = {
  /** Maximum queue depth for a single user before rejecting new prompts */
  MAX_USER_QUEUE_DEPTH: 5,
  /** Target latency budget for memory retrieval in milliseconds */
  MEMORY_LATENCY_BUDGET_MS: 50,
  /** Discord message character limit */
  DISCORD_MESSAGE_MAX_CHARS: 2000,
  /** Maximum file upload size in bytes (25MB) */
  MAX_UPLOAD_SIZE_BYTES: 25 * 1024 * 1024,
  /** Maximum text extract display characters */
  MAX_TEXT_DISPLAY_CHARS: 50000,
  /** Rate limit window for summary command in seconds */
  SUMMARY_COOLDOWN_SECONDS: 60
} as const;

export const DEFAULT_USER_SETTINGS = {
  continuousReply: false,
  customTone: 'friendly',
  timezone: 'UTC',
  preferredModel: AI_MODELS.FLASH
} as const;

export const DEFAULT_SERVER_SETTINGS = {
  overrideUserSettings: false,
  allowedChannels: [] as string[],
  alwaysRespondChannels: [] as string[],
  blacklistedUsers: [] as string[],
  rouletteEnabled: false,
  rouletteRarity: 0.05,
  reviveIntervalHours: 24,
  reviveEnabled: false
} as const;
