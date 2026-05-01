import { describe, it, expect } from 'vitest';

describe('daemon extension message routing', () => {
  it('hasTab returns false for unknown trace', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    expect(daemon.hasTab('trace-abc')).toBe(false);
    expect(daemon.listTabs()).toEqual([]);
  });

  it('getQueryFocus returns null for unknown client', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    expect(daemon.getQueryFocus('unknown', 1)).toBeNull();
  });

  it('storeQueryResults + getQueryFocus round-trips', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    const rows = [
      { items: [{ focus: { moment: { event: 42, instr: 7 } }, pml: { t: 'inline', c: ['test'] } }] },
    ];
    daemon.storeQueryResults('c1', rows);
    const focus = daemon.getQueryFocus('c1', 1);
    expect(focus).toEqual({ moment: { event: 42, instr: 7 } });
  });

  it('getQueryFocus returns null for out-of-range index', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    daemon.storeQueryResults('c1', [{ items: [{ focus: { moment: { event: 1, instr: 0 } } }] }]);
    expect(daemon.getQueryFocus('c1', 0)).toBeNull();
    expect(daemon.getQueryFocus('c1', 2)).toBeNull();
  });

  it('getQueryFocus returns null for non-items rows', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const daemon = new Daemon();
    daemon.storeQueryResults('c1', [{ t: 'inline', c: ['raw pml'] }]);
    expect(daemon.getQueryFocus('c1', 1)).toBeNull();
  });
});

describe('extension error replies', () => {
  it('query to non-existent trace returns error quickly', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const { MockExtension } = await import('./mock_extension.js');

    const daemon = new Daemon();
    const port = await daemon.start();
    const ext = new MockExtension();
    await ext.connect(port);
    await new Promise(r => setTimeout(r, 100));

    // Register a known tab
    ext.registerTab('known-trace', () => ({ focus: { moment: { event: 1, instr: 0 } } }));
    await new Promise(r => setTimeout(r, 50));

    // Try getTraceBackend for unknown trace — should throw immediately
    expect(() => daemon.getTraceBackend('unknown-trace')).toThrow('not found');

    ext.close();
    await daemon.shutdown();
  });

  it('query on forgotten tab returns QueryError quickly, not QueryTimeout', async () => {
    const { Daemon } = await import('../src/daemon.js');
    const { MockExtension } = await import('./mock_extension.js');
    const { QueryError } = await import('../src/errors.js');

    const daemon = new Daemon();
    const port = await daemon.start();
    const ext = new MockExtension();
    await ext.connect(port);
    await new Promise(r => setTimeout(r, 100));

    ext.registerTab('trace-a', () => ({}));
    await new Promise(r => setTimeout(r, 50));

    // Silently remove from extension without telling daemon — backend still exists
    ext.forgetTab('trace-a');

    const backend = daemon.getTraceBackend('trace-a');
    const start = Date.now();
    await expect(backend.getStatus()).rejects.toThrow(QueryError);
    expect(Date.now() - start).toBeLessThan(1000);

    ext.close();
    await daemon.shutdown();
  });
});

describe('replyId format', () => {
  it('traceId::rN format round-trips through indexOf split', () => {
    const traceId = 'ps0J9-pJ2TxCDiz5XJu-2g';
    const counter = 42;
    const replyId = `${traceId}::r${counter}`;

    const sep = replyId.indexOf('::r');
    expect(sep).not.toBe(-1);
    const extracted = replyId.slice(0, sep);
    expect(extracted).toBe(traceId);
  });

  it('traceId with dashes and underscores parses correctly', () => {
    const traceId = 'a-b_c-D_E';
    const replyId = `${traceId}::r0`;
    const sep = replyId.indexOf('::r');
    expect(replyId.slice(0, sep)).toBe(traceId);
  });

  it('traceId containing colons (but not ::r) parses correctly', () => {
    const traceId = 'trace:with:colons';
    const replyId = `${traceId}::r99`;
    const sep = replyId.indexOf('::r');
    expect(replyId.slice(0, sep)).toBe(traceId);
  });
});
