import { GoogleGenAI } from '@google/genai';
import { keyRotation } from '@/core/ai/key-rotation.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('GenAIClient');

export class GenAIClientFactory {
  private static instance: GenAIClientFactory;
  private clientCache = new Map<string, GoogleGenAI>();

  private constructor() {}

  public static get(): GenAIClientFactory {
    if (!GenAIClientFactory.instance) {
      GenAIClientFactory.instance = new GenAIClientFactory();
    }
    return GenAIClientFactory.instance;
  }

  /**
   * Returns a GoogleGenAI SDK client instance bound to the currently rotated active key
   */
  public getClient(customKey?: string): { client: GoogleGenAI; apiKey: string } {
    const apiKey = customKey || keyRotation.getNextKey();
    let client = this.clientCache.get(apiKey);
    if (!client) {
      client = new GoogleGenAI({ apiKey });
      this.clientCache.set(apiKey, client);
    }
    return { client, apiKey };
  }
}

export const genAIFactory = GenAIClientFactory.get();
