import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall, TOOL_DEFS } from '../src/tools.js';
import type { Daemon } from '../src/daemon.js';

function mockDaemon(overrides: Partial<Record<keyof Daemon, unknown>> = {}): Daemon {
  return {
    bindClient: vi.fn(),
    unbindClient: vi.fn(),
    getClientTraceId: vi.fn().mockReturnValue(null),
    listTabs: vi.fn().mockReturnValue([]),
    hasTab: vi.fn().mockReturnValue(false),
    requestOpenTab: vi.fn(),
    getBackend: vi.fn().mockReturnValue({
      getStatus: vi.fn().mockResolvedValue({
        focus: { moment: { event: 100, instr: 50 } },
        source: { url: 'https://example.com/foo.cpp', pos: { line: 42 } },
      }),
    }),
    sendToExtension: vi.fn(),
    start: vi.fn(),
    ...overrides,
  } as unknown as Daemon;
}

describe('TOOL_DEFS', () => {
  it('contains session_connect', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'session_connect')).toBe(true);
  });
  it('contains session_list', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'session_list')).toBe(true);
  });
  it('contains session_status', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'session_status')).toBe(true);
  });
  it('contains session_disconnect', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'session_disconnect')).toBe(true);
  });
});

describe('session_connect', () => {
  it('extracts trace ID from URL and binds client', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(true) });
    const result = await handleToolCall(daemon, 'c1', 'session_connect', {
      url: 'https://pernos.co/debug/ps0J9-pJ2TxCDiz5XJu-2g/index.html',
    });
    expect(daemon.bindClient).toHaveBeenCalledWith('c1', 'ps0J9-pJ2TxCDiz5XJu-2g');
    expect(result.content[0].text).toContain('ps0J9-pJ2TxCDiz5XJu-2g');
  });

  it('accepts raw trace ID (no URL)', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(true) });
    await handleToolCall(daemon, 'c1', 'session_connect', { url: 'ps0J9-pJ2TxCDiz5XJu-2g' });
    expect(daemon.bindClient).toHaveBeenCalledWith('c1', 'ps0J9-pJ2TxCDiz5XJu-2g');
  });

  it('requests tab open but does NOT bind when tab not found', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(false) });
    await handleToolCall(daemon, 'c1', 'session_connect', {
      url: 'https://pernos.co/debug/ps0J9-abc/index.html',
    });
    expect(daemon.requestOpenTab).toHaveBeenCalledWith('https://pernos.co/debug/ps0J9-abc/index.html');
    expect(daemon.bindClient).not.toHaveBeenCalled();
  });
});

describe('session_list', () => {
  it('returns available trace IDs', async () => {
    const daemon = mockDaemon({ listTabs: vi.fn().mockReturnValue(['trace1', 'trace2']) });
    const result = await handleToolCall(daemon, 'c1', 'session_list', {});
    expect(result.content[0].text).toContain('trace1');
    expect(result.content[0].text).toContain('trace2');
  });

  it('returns empty message when no tabs', async () => {
    const daemon = mockDaemon();
    const result = await handleToolCall(daemon, 'c1', 'session_list', {});
    expect(result.content[0].text).toContain('No');
  });
});

describe('session_status', () => {
  it('returns current focus info', async () => {
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
    });
    const result = await handleToolCall(daemon, 'c1', 'session_status', {});
    expect(result.content[0].text).toContain('event=100');
  });

  it('returns error when no session connected', async () => {
    const daemon = mockDaemon({ getClientTraceId: vi.fn().mockReturnValue(null) });
    const result = await handleToolCall(daemon, 'c1', 'session_status', {});
    expect(result.isError).toBe(true);
  });
});

describe('session_disconnect', () => {
  it('unbinds client', async () => {
    const daemon = mockDaemon({ getClientTraceId: vi.fn().mockReturnValue('trace1') });
    await handleToolCall(daemon, 'c1', 'session_disconnect', {});
    expect(daemon.unbindClient).toHaveBeenCalledWith('c1');
  });
});
