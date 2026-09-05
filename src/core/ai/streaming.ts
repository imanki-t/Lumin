import { Message, TextBasedChannel } from 'discord.js';
import { BOT_LIMITS } from '@/config/constants.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('StreamingDispatcher');

export class TokenStreamingDispatcher {
  private typingInterval: NodeJS.Timeout | null = null;

  public startTyping(channel: TextBasedChannel): void {
    try {
      if ('sendTyping' in channel) {
        channel.sendTyping().catch(() => {});
        this.typingInterval = setInterval(() => {
          channel.sendTyping().catch(() => {});
        }, 8000);
      }
    } catch {
      // Ignore typing errors
    }
  }

  public stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  /**
   * Stabilizes streaming text by ensuring open markdown code blocks (```) are closed gracefully during intermediate edits
   */
  public stabilizeMarkdown(text: string): string {
    const codeBlockMatches = text.match(/```/g);
    const count = codeBlockMatches ? codeBlockMatches.length : 0;
    if (count % 2 !== 0) {
      return text + '\n```';
    }
    return text;
  }

  /**
   * Dispatches text to Discord, splitting into chunks if > 2000 chars
   */
  public async sendFinalResponse(
    channel: TextBasedChannel,
    fullText: string,
    replyToMessage?: Message
  ): Promise<Message[]> {
    this.stopTyping();

    if (!fullText.trim()) return [];

    const chunks = this.splitMessage(fullText, BOT_LIMITS.DISCORD_MESSAGE_MAX_CHARS);
    const sentMessages: Message[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      try {
        if (i === 0 && replyToMessage) {
          const sent = await replyToMessage.reply({ content: chunk, allowedMentions: { repliedUser: false } });
          sentMessages.push(sent);
        } else {
          const sent = await (channel as any).send({ content: chunk });
          sentMessages.push(sent);
        }
      } catch (err: any) {
        logger.error('Failed to send Discord message chunk', err);
      }
    }

    return sentMessages;
  }

  private splitMessage(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let current = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if ((current + '\n' + line).length > limit) {
        if (current.trim()) chunks.push(current);
        current = line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }

    if (current.trim()) {
      chunks.push(current);
    }

    return chunks;
  }
}

export const streamingDispatcher = new TokenStreamingDispatcher();
