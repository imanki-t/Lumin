import axios from 'axios';
import { env } from '@/config/env.js';
import { ToolContext } from './memory-tools.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('MediaTools');

export async function handleSearchGif(
  args: { query: string },
  _context: ToolContext
): Promise<{ gifUrl: string | null }> {
  try {
    if (env.TENOR_API_KEY) {
      const resp = await axios.get('https://tenor.googleapis.com/v2/search', {
        params: {
          q: args.query,
          key: env.TENOR_API_KEY,
          limit: 1,
          media_filter: 'gif'
        },
        timeout: 4000
      });
      const url = resp.data?.results?.[0]?.media_formats?.gif?.url;
      if (url) return { gifUrl: url };
    }
  } catch (err: any) {
    logger.warn('Tenor search failed', err?.message);
  }

  // Fallback to GIPHY if available
  try {
    if (env.GIPHY_API_KEY) {
      const resp = await axios.get('https://api.giphy.com/v1/gifs/search', {
        params: {
          q: args.query,
          api_key: env.GIPHY_API_KEY,
          limit: 1
        },
        timeout: 4000
      });
      const url = resp.data?.data?.[0]?.images?.original?.url;
      if (url) return { gifUrl: url };
    }
  } catch (err: any) {
    logger.warn('Giphy search failed', err?.message);
  }

  return { gifUrl: null };
}

export async function handleFetchMeme(
  args: { topic?: string; subreddit?: string; sort?: string },
  _context: ToolContext
): Promise<{ title: string; memeUrl: string; source: string } | null> {
  const sub = args.subreddit || 'memes';

  // 1. Try meme-api.com
  try {
    const resp = await axios.get(`https://meme-api.com/gimme/${encodeURIComponent(sub)}`, { timeout: 4000 });
    if (resp.data?.url) {
      return {
        title: resp.data.title || 'Meme',
        memeUrl: resp.data.url,
        source: `r/${sub}`
      };
    }
  } catch {
    // Continue to fallback
  }

  // 2. Try Reddit JSON API
  try {
    const resp = await axios.get(`https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=10`, {
      headers: { 'User-Agent': 'LuminBot/4.0' },
      timeout: 4000
    });
    const posts = resp.data?.data?.children || [];
    for (const post of posts) {
      const url = post.data?.url;
      if (url && (url.endsWith('.jpg') || url.endsWith('.png') || url.endsWith('.gif'))) {
        return {
          title: post.data.title || 'Meme',
          memeUrl: url,
          source: `r/${sub}`
        };
      }
    }
  } catch {
    // Continue to fallback
  }

  return null;
}

export async function handleGetServerEmojis(
  _args: Record<string, never>,
  context: ToolContext
): Promise<{ emojis: string[] }> {
  if (!context.client || !context.guildId) return { emojis: [] };
  try {
    const guild = context.client.guilds?.cache.get(context.guildId);
    if (!guild) return { emojis: [] };
    const list = guild.emojis.cache.map((e: any) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);
    return { emojis: list.slice(0, 50) };
  } catch {
    return { emojis: [] };
  }
}
