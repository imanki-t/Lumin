import { describe, it, expect } from 'vitest';
import { UserMessageQueue } from '@/core/queue/message-queue.js';

describe('UserMessageQueue', () => {
  it('should process actions sequentially per user', async () => {
    const queue = UserMessageQueue.get();
    const userId = 'user_test_seq_1';
    const executionOrder: number[] = [];

    let resolve1!: () => void;
    let resolve2!: () => void;
    let resolve3!: () => void;
    const p1 = new Promise<void>((r) => (resolve1 = r));
    const p2 = new Promise<void>((r) => (resolve2 = r));
    const p3 = new Promise<void>((r) => (resolve3 = r));

    queue.enqueue(userId, async () => {
      await new Promise((res) => setTimeout(res, 30));
      executionOrder.push(1);
      resolve1();
    });

    queue.enqueue(userId, async () => {
      await new Promise((res) => setTimeout(res, 10));
      executionOrder.push(2);
      resolve2();
    });

    queue.enqueue(userId, async () => {
      executionOrder.push(3);
      resolve3();
    });

    await Promise.all([p1, p2, p3]);

    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('should clean up active queues when drained', async () => {
    const queue = UserMessageQueue.get();
    const userId = 'user_test_clean_1';

    let resolveTask!: () => void;
    const p = new Promise<void>((r) => (resolveTask = r));

    queue.enqueue(userId, async () => {
      await new Promise((res) => setTimeout(res, 10));
      resolveTask();
    });

    await p;
    // Wait an extra tick for cleanup
    await new Promise((res) => setTimeout(res, 20));
    expect(queue.getQueueDepth(userId)).toBe(0);
  });
});
