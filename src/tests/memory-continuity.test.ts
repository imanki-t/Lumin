import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryContinuityPipeline } from '@/core/memory/continuity.js';

describe('MemoryContinuityPipeline', () => {
  const pipeline = MemoryContinuityPipeline.get();
  const contextId = 'test_context_pipeline_1';

  beforeEach(async () => {
    await pipeline.clearSlidingWindow(contextId);
  });

  it('should return empty turns for a fresh context', async () => {
    const turns = await pipeline.getSlidingWindow(contextId);
    expect(turns).toEqual([]);
  });

  it('should append and retrieve conversation turns in correct chronological order', async () => {
    await pipeline.appendTurn(contextId, 'user', 'Hello Lumin!', {
      senderId: 'user_123',
      senderName: 'TestUser'
    });

    await pipeline.appendTurn(contextId, 'model', 'Hello! How can I assist you today?');

    const turns = await pipeline.getSlidingWindow(contextId);
    expect(turns.length).toBe(2);
    expect(turns[0]!.role).toBe('user');
    expect(turns[0]!.parts[0]!.text).toBe('Hello Lumin!');
    expect(turns[1]!.role).toBe('model');
    expect(turns[1]!.parts[0]!.text).toBe('Hello! How can I assist you today?');
  });

  it('should clear sliding window upon request', async () => {
    await pipeline.appendTurn(contextId, 'user', 'Ping');
    let turns = await pipeline.getSlidingWindow(contextId);
    expect(turns.length).toBe(1);

    await pipeline.clearSlidingWindow(contextId);
    turns = await pipeline.getSlidingWindow(contextId);
    expect(turns.length).toBe(0);
  });
});
