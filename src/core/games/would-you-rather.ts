import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { redis } from '@/core/cache/redis.js';

export interface WYRDilemma {
  id: string;
  optionA: string;
  optionB: string;
  votesA: number;
  votesB: number;
  votedUserIds: string[];
}

export class WouldYouRatherEngine {
  private static getKey(id: string): string {
    return `game:wyr:${id}`;
  }

  public static async generateDilemma(id: string): Promise<WYRDilemma> {
    const router = AIRouter.get();
    const prompt = `Generate an agonizing, funny, or thought-provoking "Would you rather..." dilemma with two clear options (Option A and Option B).
Format strictly as JSON:
{
  "optionA": "string",
  "optionB": "string"
}`;

    let optionA = 'Always speak in rhymes';
    let optionB = 'Only communicate in memes and gifs';

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: AI_MODELS.FLASH_LITE,
          temperature: 0.95
        }
      );
      const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.optionA && parsed.optionB) {
        optionA = parsed.optionA;
        optionB = parsed.optionB;
      }
    } catch {
      // Keep defaults
    }

    const dilemma: WYRDilemma = {
      id,
      optionA,
      optionB,
      votesA: 0,
      votesB: 0,
      votedUserIds: []
    };

    await redis.set(this.getKey(id), JSON.stringify(dilemma), 3600);
    return dilemma;
  }

  public static async vote(id: string, userId: string, choice: 'A' | 'B'): Promise<WYRDilemma | null> {
    const raw = await redis.get(this.getKey(id));
    if (!raw) return null;

    const dilemma: WYRDilemma = typeof raw === 'string' ? JSON.parse(raw) : (raw as WYRDilemma);
    if (dilemma.votedUserIds.includes(userId)) {
      return dilemma; // Already voted
    }

    dilemma.votedUserIds.push(userId);
    if (choice === 'A') {
      dilemma.votesA += 1;
    } else {
      dilemma.votesB += 1;
    }

    await redis.set(this.getKey(id), JSON.stringify(dilemma), 3600);
    return dilemma;
  }
}
