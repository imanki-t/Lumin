import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Discord Bot Settings
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),

  // AI Keys & Endpoints (Comma-separated for multi-key pool)
  GEMINI_API_KEYS: z
    .string()
    .min(1, 'At least one GEMINI_API_KEY must be provided')
    .transform((val) => val.split(',').map((k) => k.trim()).filter(Boolean)),
  DEFAULT_GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  FALLBACK_GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  LOCAL_GEMMA_ENDPOINT: z.string().default('http://localhost:11434'),

  // Redis Cache
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('lumin:'),

  // Database
  MONGODB_URI: z.string().default('mongodb://localhost:27017/lumin'),
  DATABASE_URL: z.string().optional(),

  // Web & Dashboard
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DASHBOARD_AUTH_SECRET: z.string().default('lumin-super-secret-key-change-in-production-32b'),
  DASHBOARD_ADMIN_IDS: z
    .string()
    .default('')
    .transform((val) => val.split(',').map((id) => id.trim()).filter(Boolean)),

  // External APIs
  TENOR_API_KEY: z.string().optional(),
  GIPHY_API_KEY: z.string().optional(),

  // Monitoring
  ALERT_WEBHOOK_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info')
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig;

try {
  validatedEnv = envSchema.parse(process.env);
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    // Provide fallback mock for unit testing environment
    validatedEnv = envSchema.parse({
      DISCORD_TOKEN: 'mock_discord_token_for_testing',
      GEMINI_API_KEYS: 'mock_gemini_key_1,mock_gemini_key_2',
      NODE_ENV: 'test'
    });
  } else {
    console.error('❌ Environment validation failed:', error);
    throw error;
  }
}

export const env = validatedEnv;
