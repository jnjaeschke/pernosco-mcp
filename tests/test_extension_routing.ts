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
