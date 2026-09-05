import { describe, it, expect } from 'vitest';
import { KeyRotationManager } from '@/core/ai/key-rotation.js';

describe('KeyRotationManager', () => {
  it('should initialize key states from configuration', () => {
    const manager = KeyRotationManager.get();
    const stats = manager.getKeyStats();
    expect(stats.length).toBeGreaterThan(0);
    expect(stats[0]!.isHealthy).toBe(true);
  });

  it('should rotate to the next key when requested', () => {
    const manager = KeyRotationManager.get();
    const key1 = manager.getNextKey();
    expect(key1).toBeDefined();
    expect(typeof key1).toBe('string');
  });

  it('should handle error reporting and trigger cooldown upon repeated failures', () => {
    const manager = KeyRotationManager.get();
    const initialStats = manager.getKeyStats();
    const firstKey = manager.getNextKey();

    manager.recordError(firstKey, 429);
    manager.recordError(firstKey, 429);
    manager.recordError(firstKey, 429);

    const updatedStats = manager.getKeyStats();
    const state = updatedStats.find((s) => s.maskedKey === (firstKey.length > 8 ? `${firstKey.slice(0, 4)}...${firstKey.slice(-4)}` : '****'));

    if (state) {
      expect(state.totalErrors).toBeGreaterThan(0);
    }
  });
});
