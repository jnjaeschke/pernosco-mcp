import { describe, it, expect, vi } from 'vitest';

describe('Daemon.cleanupClient', () => {
  it('removes lastResults for client', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();

    daemon.storeQueryResults('client1', [{ items: [{ focus: { moment: { event: 1, instr: 0 } } }] }]);
    expect(daemon.getQueryFocus('client1', 1)).not.toBeNull();

    daemon.cleanupClient('client1');
    expect(daemon.getQueryFocus('client1', 1)).toBeNull();
  });
});

describe('Daemon.bindClient', () => {
  it('rejects traceId containing ::r separator', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    expect(() => daemon.bindClient('c1', 'bad::rtraceId')).toThrow('reserved separator');
  });
});

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
