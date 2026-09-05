import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';

export class NeverHaveIEverEngine {
  public static async generatePrompt(): Promise<string> {
    const router = AIRouter.get();
    const prompt = `Generate a single hilarious, relatable, or surprising "Never have I ever..." statement for a group of friends chatting in Discord.
Examples:
"Never have I ever stayed up until 5 AM arguing over something completely irrelevant on the internet."
"Never have I ever pretended my microphone was broken to avoid joining a voice call."
Return ONLY the statement beginning with "Never have I ever...".`;

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: prompt }] }],
        {
          model: AI_MODELS.FLASH_LITE,
          temperature: 0.9
        }
      );
      return response.text.trim();
    } catch {
      const fallbacks = [
        'Never have I ever laughed so hard that liquid came out of my nose.',
        'Never have I ever ghosted someone and then ran into them in person.',
        'Never have I ever pretended to be busy just to stay home and play video games.',
        'Never have I ever sent a message in the wrong channel and panicked trying to delete it in 0.2 seconds.'
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)]!;
    }
  }
}
