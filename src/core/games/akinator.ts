import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';
import { redis } from '@/core/cache/redis.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('AkinatorEngine');

export interface AkinatorState {
  gameId: string;
  userId: string;
  channelId: string;
  questionCount: number;
  history: Array<{ question: string; answer: string }>;
  currentQuestion: string;
  candidateGuess?: string;
  confidence: number;
  isFinished: boolean;
}

export class AkinatorEngine {
  private static instance: AkinatorEngine;

  private constructor() {}

  public static get(): AkinatorEngine {
    if (!AkinatorEngine.instance) {
      AkinatorEngine.instance = new AkinatorEngine();
    }
    return AkinatorEngine.instance;
  }

  private getKey(gameId: string): string {
    return `game:aki:${gameId}`;
  }

  /**
   * Starts a new Akinator session
   */
  public async startGame(gameId: string, userId: string, channelId: string): Promise<AkinatorState> {
    const firstQuestion = 'Is your character a real person (not fictional)?';
    const state: AkinatorState = {
      gameId,
      userId,
      channelId,
      questionCount: 1,
      history: [],
      currentQuestion: firstQuestion,
      confidence: 0,
      isFinished: false
    };

    await redis.set(this.getKey(gameId), JSON.stringify(state), 1800); // 30 min TTL
    return state;
  }

  /**
   * Retrieves active game state
   */
  public async getState(gameId: string): Promise<AkinatorState | null> {
    const raw = await redis.get(this.getKey(gameId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AkinatorState;
    } catch {
      return null;
    }
  }

  /**
   * Processes player's answer and determines the next question or final guess
   */
  public async submitAnswer(
    gameId: string,
    answer: 'yes' | 'probably' | 'dontknow' | 'probablynot' | 'no'
  ): Promise<AkinatorState> {
    const state = await this.getState(gameId);
    if (!state || state.isFinished) {
      throw new Error('Game session has expired or is already completed.');
    }

    state.history.push({
      question: state.currentQuestion,
      answer
    });
    state.questionCount += 1;

    // Build reasoning prompt for Gemini Flash-Lite
    const aiRouter = AIRouter.get();
    const prompt = `You are the master Akinator 20-Questions AI.
The player is thinking of a famous fictional character, real person, celebrity, movie/game figure, or concept.

Here is the dialogue history so far:
${state.history.map((h, i) => `${i + 1}. Q: "${h.question}" -> A: "${h.answer}"`).join('\n')}

Task:
Evaluate the remaining possibilities.
If you have high confidence (>85%) or this is question #15+, formulate your final guess.
Otherwise, formulate the next optimal distinguishing Yes/No question that cuts the hypothesis space in half.

Respond STRICTLY in valid JSON matching this schema:
{
  "guessReady": boolean,
  "candidate": "string (name of character if guessReady, else null)",
  "confidence": number (0 to 100),
  "nextQuestion": "string (the next question to ask, or empty if guessReady)"
}`;

    try {
      const result = await aiRouter.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: AI_MODELS.FLASH_LITE,
          temperature: 0.2
        }
      );

      // Clean markdown code blocks from JSON
      const cleaned = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.guessReady && parsed.candidate) {
        state.isFinished = true;
        state.candidateGuess = parsed.candidate;
        state.confidence = parsed.confidence;
      } else {
        state.currentQuestion = parsed.nextQuestion || 'Is your character associated with gaming?';
        state.confidence = parsed.confidence || 20;
      }
    } catch (err: any) {
      logger.error('Failed generating next Akinator step', err);
      // Fallback question
      state.currentQuestion = 'Does your character have supernatural or magical powers?';
    }

    await redis.set(this.getKey(gameId), JSON.stringify(state), 1800);
    return state;
  }
}
