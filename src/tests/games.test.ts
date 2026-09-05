import { describe, it, expect } from 'vitest';
import { WouldYouRatherEngine } from '@/core/games/would-you-rather.js';

describe('Game Engines', () => {
  it('should initialize and vote on Would You Rather dilemmas', async () => {
    const gameId = 'test_wyr_1';
    const dilemma = await WouldYouRatherEngine.generateDilemma(gameId);

    expect(dilemma.id).toBe(gameId);
    expect(dilemma.optionA).toBeDefined();
    expect(dilemma.optionB).toBeDefined();
    expect(dilemma.votesA).toBe(0);
    expect(dilemma.votesB).toBe(0);

    // Vote for Option A
    const updatedA = await WouldYouRatherEngine.vote(gameId, 'voter_1', 'A');
    expect(updatedA?.votesA).toBe(1);
    expect(updatedA?.votesB).toBe(0);

    // Vote for Option B
    const updatedB = await WouldYouRatherEngine.vote(gameId, 'voter_2', 'B');
    expect(updatedB?.votesA).toBe(1);
    expect(updatedB?.votesB).toBe(1);

    // Prevent duplicate voting by same user
    const duplicate = await WouldYouRatherEngine.vote(gameId, 'voter_1', 'B');
    expect(duplicate?.votesB).toBe(1); // Unchanged
  });
});
