import { describe, it, expect, vi } from 'vitest';

describe('withTimeout', () => {
  it('rejects after timeout', async () => {
    const { withTimeout } = await import('../src/daemon.js');
    const neverResolves = new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 50, 'test')).rejects.toThrow('timed out');
  });

  it('resolves if inner resolves before timeout', async () => {
    const { withTimeout } = await import('../src/daemon.js');
    const fast = Promise.resolve('ok');
    await expect(withTimeout(fast, 1000, 'test')).resolves.toBe('ok');
  });

  it('cleans up timer on success', async () => {
    const { withTimeout } = await import('../src/daemon.js');
    vi.useFakeTimers();
    const result = withTimeout(Promise.resolve(42), 5000, 'test');
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toBe(42);
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
  });
});
