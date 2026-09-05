import { aiRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { memoryRepo } from '@/core/database/repositories/index.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DialogueSummarizer');

export class DialogueSummarizer {
  private static instance: DialogueSummarizer;
  private pendingJobs = new Set<string>();

  private constructor() {}

  public static get(): DialogueSummarizer {
    if (!DialogueSummarizer.instance) {
      DialogueSummarizer.instance = new DialogueSummarizer();
    }
    return DialogueSummarizer.instance;
  }

  /**
   * Asynchronously generates and updates the rolling dialogue summary in the background without blocking chat turn
   */
  public triggerAsyncSummarization(contextId: string, dialogueLines: string[]): void {
    if (this.pendingJobs.has(contextId)) {
      return; // Already running summary for this context
    }

    if (dialogueLines.length < 4) return;

    this.pendingJobs.add(contextId);

    // Run in parallel background worker
    setImmediate(async () => {
      try {
        await this.generateRollingSummary(contextId, dialogueLines);
      } catch (err: any) {
        logger.error(`Background summarization failed for ${contextId}`, err);
      } finally {
        this.pendingJobs.delete(contextId);
      }
    });
  }

  public async triggerAsyncSummary(contextId: string, turns: any[]): Promise<void> {
    const lines = turns.map((t) => {
      if (typeof t === 'string') return t;
      const text = t.parts?.[0]?.text || '';
      return `${t.role}: ${text}`;
    });
    this.triggerAsyncSummarization(contextId, lines);
  }

  private async generateRollingSummary(contextId: string, dialogueLines: string[]): Promise<void> {
    const existingSummary = await memoryRepo.getSummary(contextId);
    const existingContext = existingSummary ? `Existing Summary:\n${existingSummary.summary}\n\n` : '';

    const prompt = `${existingContext}New Dialogue Turns:\n${dialogueLines.join('\n')}\n\nTask: Produce a dense, factual, rolling summary of key topics discussed, user decisions, mentioned entities, and open points. Keep it under 200 words.`;

    const response = await aiRouter.generateContent(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        model: AI_MODELS.FLASH_LITE,
        temperature: 0.2,
        maxOutputTokens: 512,
        enableTools: false
      }
    );

    if (response.text.trim()) {
      await memoryRepo.saveSummary({
        id: `sum_${contextId}`,
        contextId,
        summary: response.text.trim(),
        keyTopics: [],
        messageCount: (existingSummary?.messageCount || 0) + dialogueLines.length,
        lastMessageTimestamp: new Date(),
        updatedAt: new Date()
      });
      logger.debug(`Updated rolling dialogue summary for ${contextId}`);
    }
  }
}

export const dialogueSummarizer = DialogueSummarizer.get();
