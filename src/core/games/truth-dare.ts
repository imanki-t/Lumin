import { AIRouter } from '@/core/ai/router.js';
import { AI_MODELS } from '@/config/constants.js';

export type TDSMode = 'truth' | 'dare' | 'situation' | 'random';
export type TDSRating = 'mild' | 'party' | 'wild';

export class TruthDareEngine {
  public static async generatePrompt(mode: TDSMode, rating: TDSRating = 'party'): Promise<{
    type: 'Truth' | 'Dare' | 'Situation';
    content: string;
  }> {
    const selectedMode: 'Truth' | 'Dare' | 'Situation' =
      mode === 'random'
        ? (['Truth', 'Dare', 'Situation'] as const)[Math.floor(Math.random() * 3)]!
        : mode.charAt(0).toUpperCase() + mode.slice(1) as any;

    const router = AIRouter.get();
    const instruction = `You are a hilarious, high-energy party game host in a Discord server.
Generate a single, creative, engaging ${selectedMode} prompt for Discord friends.
Intensity level: ${rating} (mild = casual/friendly, party = fun/embarrassing, wild = bold/spicy).
Keep it appropriate for Discord community guidelines (PG-13 to PG-16).
Return ONLY the prompt text, without quotes or prefixes.`;

    try {
      const response = await router.generateContent(
        [{ role: 'user', parts: [{ text: instruction }] }],
        {
          model: AI_MODELS.FLASH_LITE,
          temperature: 0.85
        }
      );

      return {
        type: selectedMode,
        content: response.text.trim()
      };
    } catch {
      // Fallbacks if AI service is temporarily offline
      const fallbacks: Record<string, string[]> = {
        Truth: [
          'What is the most embarrassing text message you accidentally sent to the wrong person?',
          'What is a secret talent or weird hobby you have never told anyone here about?',
          'If you could delete one memory from your brain, what would it be?'
        ],
        Dare: [
          'Change your Discord nickname to whatever the chat decides for the next 1 hour.',
          'Send the most unhinged meme in your camera roll right now without any explanation.',
          'Type your next 5 messages using voice-to-text only without correcting any mistakes.'
        ],
        Situation: [
          'You are stranded in an elevator with your server admin and your celebrity crush. What do you say first?',
          'A glitch in Discord makes all your deleted messages visible to everyone for 60 seconds. What is your reaction?'
        ]
      };

      const pool = fallbacks[selectedMode] || fallbacks.Truth!;
      return {
        type: selectedMode,
        content: pool[Math.floor(Math.random() * pool.length)]!
      };
    }
  }
}
