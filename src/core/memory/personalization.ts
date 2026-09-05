import { userRepo, guildRepo, memoryRepo } from '@/core/database/repositories/index.js';
import { profileManager } from './profile.js';

export interface PersonaAssemblyOptions {
  userId: string;
  guildId?: string;
  channelId: string;
  isDM?: boolean;
}

export class AdaptivePersonalizationEngine {
  private static instance: AdaptivePersonalizationEngine;

  private constructor() {}

  public static get(): AdaptivePersonalizationEngine {
    if (!AdaptivePersonalizationEngine.instance) {
      AdaptivePersonalizationEngine.instance = new AdaptivePersonalizationEngine();
    }
    return AdaptivePersonalizationEngine.instance;
  }

  /**
   * Dynamically constructs the comprehensive system instructions tailored to user and guild context
   */
  public async buildSystemInstruction(options: PersonaAssemblyOptions): Promise<string> {
    const userSettings = await userRepo.getSettings(options.userId);
    const userProfileSnippet = await profileManager.getUserContextSnippet(options.userId);

    let serverFactsSnippet = '';
    let guildTone = userSettings.customTone || 'friendly';

    if (options.guildId) {
      const guildSettings = await guildRepo.getSettings(options.guildId);
      if (guildSettings.serverFacts.length > 0) {
        const sFacts = guildSettings.serverFacts.map((f) => `- [${f.category}] ${f.fact}`).join('\n');
        serverFactsSnippet = `\n[Server Lore & Shared Facts]:\n${sFacts}\n`;
      }
    }

    const contextId = options.guildId ? `${options.guildId}:${options.channelId}` : `dm:${options.userId}`;
    const rollingSummary = await memoryRepo.getSummary(contextId);
    const summarySnippet = rollingSummary ? `\n[Ongoing Conversation Summary]:\n${rollingSummary.summary}\n` : '';

    return [
      `You are Lumin, an intelligent, charming, and highly capable AI assistant on Discord.`,
      `Tone & Persona Style: ${guildTone}.`,
      `Rules & Guidelines:`,
      `- Speak naturally, directly, and engagingly. Avoid robotic boilerplate.`,
      `- Seamlessly incorporate known user facts and ongoing conversation summary when relevant.`,
      `- When asked to store facts, reminders, or trigger actions, call the appropriate function tools.`,
      `- Do not fabricate facts about users; only use verified context provided below.`,
      userProfileSnippet,
      serverFactsSnippet,
      summarySnippet
    ]
      .filter(Boolean)
      .join('\n');
  }

  public async buildSystemPrompt(options: {
    userId: string;
    userName?: string;
    guildId?: string;
    contextSummary?: string;
    preferredTone?: string;
  }): Promise<string> {
    return this.buildSystemInstruction({
      userId: options.userId,
      guildId: options.guildId,
      channelId: options.guildId || 'dm'
    });
  }
}

export const personalizationEngine = AdaptivePersonalizationEngine.get();
