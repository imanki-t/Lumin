import { AI_MODELS, AIModelType } from '@/config/constants.js';
import { genAIFactory } from './client.js';
import { keyRotation } from './key-rotation.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { geminiToolDeclarations } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { ToolContext } from './tools/memory-tools.js';
import { usageRepo } from '@/core/database/repositories/index.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('AIRouter');

export interface GenerateOptions {
  model?: AIModelType | string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  enableTools?: boolean;
  toolContext?: ToolContext;
  onTokenChunk?: (chunk: string) => Promise<void>;
}

export interface ConversationTurn {
  role: 'user' | 'model' | 'system';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export class AIRouter {
  private static instance: AIRouter;
  private circuitBreakers = new Map<string, CircuitBreaker>();

  private constructor() {
    this.circuitBreakers.set(AI_MODELS.FLASH, new CircuitBreaker(AI_MODELS.FLASH));
    this.circuitBreakers.set(AI_MODELS.FLASH_LITE, new CircuitBreaker(AI_MODELS.FLASH_LITE));
    this.circuitBreakers.set(AI_MODELS.GEMMA_9B, new CircuitBreaker(AI_MODELS.GEMMA_9B));
  }

  public static get(): AIRouter {
    if (!AIRouter.instance) {
      AIRouter.instance = new AIRouter();
    }
    return AIRouter.instance;
  }

  private getBreaker(model: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(model);
    if (!cb) {
      cb = new CircuitBreaker(model);
      this.circuitBreakers.set(model, cb);
    }
    return cb;
  }

  /**
   * Main completion method with automatic model routing, circuit breaking, key rotation, and tool loop
   */
  public async generateContent(
    contents: ConversationTurn[],
    options: GenerateOptions = {}
  ): Promise<{ text: string; modelUsed: string; toolCallsExecuted: string[] }> {
    const targetModel = options.model || AI_MODELS.FLASH;
    const breaker = this.getBreaker(targetModel);

    return await breaker.execute(
      async () => {
        const { client, apiKey } = genAIFactory.getClient();
        try {
          const config: any = {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxOutputTokens ?? 2048
          };

          if (options.systemInstruction) {
            config.systemInstruction = options.systemInstruction;
          }

          if (options.enableTools) {
            config.tools = geminiToolDeclarations;
          }

          logger.debug(`Calling AI model ${targetModel} via @google/genai`);

          const response = await client.models.generateContent({
            model: targetModel,
            contents: contents as any,
            config
          });

          keyRotation.recordSuccess(apiKey);

          // Track usage metrics
          const usage = (response as any).usageMetadata || {};
          await usageRepo.recordUsage({
            promptTokens: usage.promptTokenCount || 0,
            candidateTokens: usage.candidatesTokenCount || 0,
            model: targetModel
          });

          let fullText = '';
          const executedTools: string[] = [];

          // Handle function calls if model returned function calls
          const functionCalls = (response as any).functionCalls || [];
          if (functionCalls.length > 0 && options.toolContext) {
            for (const call of functionCalls) {
              const toolName = call.name;
              const toolArgs = call.args || {};
              executedTools.push(toolName);

              const toolResult = await ToolExecutor.execute(toolName, toolArgs, options.toolContext);

              // Record tool metric
              await usageRepo.recordUsage({
                promptTokens: 0,
                candidateTokens: 0,
                model: targetModel,
                toolCallName: toolName
              });

              // Send tool output back to model for follow-up response if not ignored
              if (toolName === 'ignore_user') {
                return { text: '', modelUsed: targetModel, toolCallsExecuted: executedTools };
              }

              // Append tool response to turn history and invoke second pass
              const followUpTurns: ConversationTurn[] = [
                ...contents,
                { role: 'model', parts: [{ text: `Called function: ${toolName}` }] },
                {
                  role: 'user',
                  parts: [{ text: `Tool result for ${toolName}: ${JSON.stringify(toolResult)}` }]
                }
              ];

              const secondPass = await client.models.generateContent({
                model: targetModel,
                contents: followUpTurns as any,
                config: {
                  ...config,
                  tools: undefined // Disable tools on final synthesis pass
                }
              });

              fullText = secondPass.text || '';
            }
          } else {
            fullText = response.text || '';
          }

          return {
            text: fullText,
            modelUsed: targetModel,
            toolCallsExecuted: executedTools
          };
        } catch (err: any) {
          const status = err?.status || err?.statusCode || (err?.message?.includes('429') ? 429 : 500);
          keyRotation.recordError(apiKey, status);
          logger.error(`AI Model execution failed on ${targetModel}:`, err);
          throw err;
        }
      },
      // Fallback action if circuit trips or primary fails: Try gemini-3.5-flash-lite
      async () => {
        if (targetModel !== AI_MODELS.FLASH_LITE) {
          logger.info(`Circuit fallback: Routing request from ${targetModel} to ${AI_MODELS.FLASH_LITE}`);
          return await this.generateContent(contents, {
            ...options,
            model: AI_MODELS.FLASH_LITE
          });
        }
        throw new Error('All AI models and fallbacks exhausted.');
      }
    );
  }

  /**
   * Fast utility classification / intent detection using ultra-low-latency Flash Lite
   */
  public async classifyIntent(prompt: string, intents: string[]): Promise<string> {
    try {
      const response = await this.generateContent(
        [
          {
            role: 'user',
            parts: [
              {
                text: `Classify the following user message into EXACTLY one of these categories: [${intents.join(', ')}]. Return only the category name.\n\nMessage: "${prompt}"`
              }
            ]
          }
        ],
        {
          model: AI_MODELS.FLASH_LITE,
          temperature: 0.1,
          maxOutputTokens: 32,
          enableTools: false
        }
      );

      const matched = intents.find((i) => response.text.toLowerCase().includes(i.toLowerCase()));
      return matched || intents[0]!;
    } catch {
      return intents[0]!;
    }
  }

  /**
   * Generate vector embeddings via gemini-embedding-2 (solely for explicit document RAG)
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const { client, apiKey } = genAIFactory.getClient();
    try {
      const response = await (client as any).models.embedContent({
        model: AI_MODELS.EMBEDDING,
        contents: text
      });
      keyRotation.recordSuccess(apiKey);
      return response.embedding.values;
    } catch (err: any) {
      keyRotation.recordError(apiKey, err?.status);
      logger.error('Failed to generate embedding with gemini-embedding-2', err);
      return [];
    }
  }
}

export const aiRouter = AIRouter.get();
