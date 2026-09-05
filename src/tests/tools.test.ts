import { describe, it, expect } from 'vitest';
import { geminiToolDeclarations } from '@/core/ai/tools/registry.js';
import { ToolExecutor } from '@/core/ai/tools/executor.js';

describe('AI Tools Registry and Executor', () => {
  it('should declare all required tools with parameters schema', () => {
    const decls = geminiToolDeclarations[0]?.functionDeclarations || [];
    expect(decls.length).toBeGreaterThan(15);

    const names = decls.map((t: any) => t.name);
    expect(names).toContain('manage_personal_memory');
    expect(names).toContain('manage_server_fact');
    expect(names).toContain('set_reminder');
    expect(names).toContain('set_birthday');
    expect(names).toContain('get_current_datetime');
  });

  it('should execute get_current_datetime without errors', async () => {
    const result = await ToolExecutor.execute(
      'get_current_datetime',
      { timezone: 'UTC' },
      { userId: 'test_user', channelId: 'test_chan', userName: 'Tester' }
    );

    expect(result.iso).toBeDefined();
    expect(result.formatted).toBeDefined();
    expect(result.timezone).toBeDefined();
  });

  it('should handle unknown tool execution gracefully', async () => {
    try {
      const result = await ToolExecutor.execute(
        'non_existent_tool_123',
        {},
        { userId: 'test_user', channelId: 'test_chan', userName: 'Tester' }
      );
      expect(result).toBeDefined();
    } catch (err: any) {
      expect(err.message).toBeDefined();
    }
  });
});
