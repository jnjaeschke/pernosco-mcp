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
    storeQueryResults: vi.fn(),
    getQueryFocus: vi.fn().mockReturnValue(null),
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

  it('extracts trace ID from URL without trailing slash', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(true) });
    await handleToolCall(daemon, 'c1', 'session_connect', {
      url: 'https://pernos.co/debug/abc123',
    });
    expect(daemon.bindClient).toHaveBeenCalledWith('c1', 'abc123');
  });

  it('extracts trace ID from URL with query string', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(true) });
    await handleToolCall(daemon, 'c1', 'session_connect', {
      url: 'https://pernos.co/debug/abc123?foo=bar',
    });
    expect(daemon.bindClient).toHaveBeenCalledWith('c1', 'abc123');
  });

  it('extracts trace ID from URL with fragment', async () => {
    const daemon = mockDaemon({ hasTab: vi.fn().mockReturnValue(true) });
    await handleToolCall(daemon, 'c1', 'session_connect', {
      url: 'https://pernos.co/debug/abc123#section',
    });
    expect(daemon.bindClient).toHaveBeenCalledWith('c1', 'abc123');
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

// ─── Phase 2 tools ───────────────────────────────────────────────────────────

const fakePmlRows = [
  { items: [{ focus: { moment: { event: 200, instr: 10 } }, pml: { t: 'inline', c: ['nsDocShell::LoadURI(...)'] } }] },
  { items: [{ focus: { moment: { event: 300, instr: 20 } }, pml: { t: 'inline', c: ['nsDocShell::LoadURI(...)'] } }] },
];

describe('TOOL_DEFS Phase 2', () => {
  it('contains find_executions', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'find_executions')).toBe(true);
  });
  it('contains stack', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'stack')).toBe(true);
  });
  it('contains evaluate', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'evaluate')).toBe(true);
  });
  it('contains goto', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'goto')).toBe(true);
  });
  it('contains task_tree', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'task_tree')).toBe(true);
  });
  it('contains search', () => {
    expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === 'search')).toBe(true);
  });
});

describe('find_executions', () => {
  it('calls rangeQuery with symbol and limit', async () => {
    const mockBackend = {
      rangeQuery: vi.fn().mockResolvedValue(fakePmlRows),
      simpleQuery: vi.fn(),
      setFocus: vi.fn(),
      getStatus: vi.fn(),
      close: vi.fn(),
    };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    const result = await handleToolCall(daemon, 'c1', 'find_executions', { symbol: 'nsDocShell::LoadURI' });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith('execution', { symbol: 'nsDocShell::LoadURI' }, 50);
    expect(daemon.storeQueryResults).toHaveBeenCalledWith('c1', fakePmlRows);
    expect(result.content[0].text).toContain('nsDocShell::LoadURI');
    expect(result.content[0].text).toContain('[1]');
  });

  it('includes print_exprs in params when provided', async () => {
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue([]), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'find_executions', { symbol: 'Foo::Bar', print_exprs: 'this->mX; this->mY' });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith('execution', { symbol: 'Foo::Bar', print: 'this->mX; this->mY' }, 50);
  });

  it('respects custom limit', async () => {
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue([]), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'find_executions', { symbol: 'Foo', limit: 10 });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith('execution', { symbol: 'Foo' }, 10);
  });

  it('returns error when not connected', async () => {
    const daemon = mockDaemon({ getClientTraceId: vi.fn().mockReturnValue(null) });
    const result = await handleToolCall(daemon, 'c1', 'find_executions', { symbol: 'Foo' });
    expect(result.isError).toBe(true);
  });
});

describe('stack', () => {
  it('calls simpleQuery with stack and empty mixArgs', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue(fakePmlRows), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    const result = await handleToolCall(daemon, 'c1', 'stack', {});
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('stack', {});
    expect(daemon.storeQueryResults).toHaveBeenCalledWith('c1', fakePmlRows);
    expect(result.content[0].text).toContain('#0');
    expect(result.content[0].text).not.toContain('[1]');
  });
});

describe('evaluate', () => {
  it('calls simpleQuery with evaluate and payload mixArgs', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue([{ t: 'inline', c: ['42'] }]), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    await handleToolCall(daemon, 'c1', 'evaluate', { expression: 'this->mCount' });
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('evaluate', { payload: { expression: 'this->mCount' } });
  });

  it('stores query results for goto navigation', async () => {
    const evalRows = [{ items: [{ focus: { moment: { event: 42, instr: 0 } }, pml: { t: 'inline', c: ['42'] } }] }];
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue(evalRows), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'evaluate', { expression: 'this->mCount' });
    expect(daemon.storeQueryResults).toHaveBeenCalledWith('c1', evalRows);
  });
});

describe('goto', () => {
  it('navigates to indexed result using stored focus', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn(), setFocus: vi.fn().mockResolvedValue(undefined), getStatus: vi.fn(), close: vi.fn() };
    const storedFocus = { moment: { event: 200, instr: 10 } };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      getQueryFocus: vi.fn().mockReturnValue(storedFocus),
    });
    const result = await handleToolCall(daemon, 'c1', 'goto', { index: 1 });
    expect(daemon.getQueryFocus).toHaveBeenCalledWith('c1', 1);
    expect(mockBackend.setFocus).toHaveBeenCalledWith(storedFocus);
    expect(result.isError).toBeUndefined();
  });

  it('returns error when index has no stored result', async () => {
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue({ setFocus: vi.fn(), rangeQuery: vi.fn(), simpleQuery: vi.fn(), getStatus: vi.fn(), close: vi.fn() }),
      getQueryFocus: vi.fn().mockReturnValue(null),
    });
    const result = await handleToolCall(daemon, 'c1', 'goto', { index: 99 });
    expect(result.isError).toBe(true);
  });

  it('navigates using raw focus object', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn(), setFocus: vi.fn().mockResolvedValue(undefined), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    const focus = { moment: { event: 500, instr: 0 } };
    await handleToolCall(daemon, 'c1', 'goto', { focus });
    expect(mockBackend.setFocus).toHaveBeenCalledWith(focus);
  });
});

describe('task_tree', () => {
  it('calls simpleQuery with task-tree', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue([]), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    await handleToolCall(daemon, 'c1', 'task_tree', {});
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('task-tree', {});
  });
});

describe('search', () => {
  it('calls simpleQuery with search and input mixArgs', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue([]), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'search', { query: 'LoadURI', max_results: 10 });
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('search', { input: 'LoadURI', maxResults: 10 });
  });

  it('uses default max_results of 20', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue([]), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'search', { query: 'Foo' });
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('search', { input: 'Foo', maxResults: 20 });
  });
});

// ─── Phase 3 tools ───────────────────────────────────────────────────────────

describe('TOOL_DEFS Phase 3', () => {
  for (const name of ['watchpoint_history', 'stdout_stderr', 'current_tasks', 'notebook_read', 'find_breakpoint_hits', 'dynamic_annotations']) {
    it(`contains ${name}`, () => {
      expect(TOOL_DEFS.some((t: unknown) => (t as { name: string }).name === name)).toBe(true);
    });
  }
});

describe('watchpoint_history', () => {
  it('calls rangeQuery with watchpoint params', async () => {
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue([]), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'watchpoint_history', { address: '0x7fff1234', type: 'uint64_t' });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith('watchpoint', { address: '0x7fff1234', type: 'uint64_t' }, 100);
  });
});

describe('stdout_stderr', () => {
  it('calls rangeQuery stdouterr and formats with event IDs', async () => {
    const rows = [
      { items: [{ focus: { moment: { event: 100, instr: 0 } }, pml: { t: 'inline', c: ['hello'] } }] },
    ];
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue(rows), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    const result = await handleToolCall(daemon, 'c1', 'stdout_stderr', {});
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith('stdouterr', {}, 200);
    expect(result.content[0].text).toContain('e=100');
    expect(result.content[0].text).toContain('hello');
  });
});

describe('current_tasks', () => {
  it('calls simpleQuery current-tasks', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn().mockResolvedValue([]), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    await handleToolCall(daemon, 'c1', 'current_tasks', {});
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('current-tasks', {});
  });
});

describe('notebook_read', () => {
  it('calls notebookRead and formats entries', async () => {
    const storageData = {
      'notebook/123': { create: { value: { focus: { moment: { event: 500, instr: 0 } }, text: 'Root cause here' } } },
    };
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn().mockResolvedValue(storageData) };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    const result = await handleToolCall(daemon, 'c1', 'notebook_read', {});
    expect(mockBackend.notebookRead).toHaveBeenCalled();
    expect(result.content[0].text).toBeTruthy();
  });

  it('returns empty message when no entries', async () => {
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn().mockResolvedValue({}) };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    const result = await handleToolCall(daemon, 'c1', 'notebook_read', {});
    expect(result.content[0].text).toContain('No');
  });
});

describe('notebook_read edge cases', () => {
  it('handles entries with missing focus gracefully', async () => {
    const storageData = {
      'notebook/123': { create: { value: { text: 'no focus here' } } },
      'notebook/456': { create: { value: { focus: { moment: { event: 10, instr: 0 } } } } },
      'notebook/789': 'completely wrong type',
    };
    const mockBackend = { rangeQuery: vi.fn(), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn().mockResolvedValue(storageData) };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    const result = await handleToolCall(daemon, 'c1', 'notebook_read', {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('no focus here');
    expect(result.content[0].text).toContain('event=10');
  });
});

describe('find_breakpoint_hits', () => {
  it('calls rangeQuery breakpoint with file and line', async () => {
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue([]), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'find_breakpoint_hits', { file: 'nsDocShell.cpp', line: 4521 });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith(
      'breakpoint',
      { url: 'nsDocShell.cpp', points: [{ l: 4521, c: 0 }] },
      50
    );
  });

  it('includes print_exprs when provided', async () => {
    const mockBackend = { rangeQuery: vi.fn().mockResolvedValue([]), simpleQuery: vi.fn(), setFocus: vi.fn(), getStatus: vi.fn(), close: vi.fn(), notebookRead: vi.fn() };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
      storeQueryResults: vi.fn(),
    });
    await handleToolCall(daemon, 'c1', 'find_breakpoint_hits', { file: 'nsDocShell.cpp', line: 4521, print_exprs: 'this->mURI' });
    expect(mockBackend.rangeQuery).toHaveBeenCalledWith(
      'breakpoint',
      { url: 'nsDocShell.cpp', points: [{ l: 4521, c: 0 }], print: 'this->mURI' },
      50
    );
  });
});

describe('dynamic_annotations', () => {
  it('calls simpleQuery dynamicAnnotations with source url from status', async () => {
    const mockBackend = {
      rangeQuery: vi.fn(),
      simpleQuery: vi.fn().mockResolvedValue([]),
      setFocus: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({ focus: { moment: { event: 100, instr: 0 } }, source: { url: 'https://example.com/foo.cpp' } }),
      close: vi.fn(),
      notebookRead: vi.fn(),
    };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    await handleToolCall(daemon, 'c1', 'dynamic_annotations', {});
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('dynamicAnnotations', { source: 'https://example.com/foo.cpp' });
  });

  it('uses provided source_url when given', async () => {
    const mockBackend = {
      rangeQuery: vi.fn(),
      simpleQuery: vi.fn().mockResolvedValue([]),
      setFocus: vi.fn(),
      getStatus: vi.fn(),
      close: vi.fn(),
      notebookRead: vi.fn(),
    };
    const daemon = mockDaemon({
      getClientTraceId: vi.fn().mockReturnValue('trace1'),
      getBackend: vi.fn().mockReturnValue(mockBackend),
    });
    await handleToolCall(daemon, 'c1', 'dynamic_annotations', { source_url: 'https://example.com/bar.cpp' });
    expect(mockBackend.simpleQuery).toHaveBeenCalledWith('dynamicAnnotations', { source: 'https://example.com/bar.cpp' });
    expect(mockBackend.getStatus).not.toHaveBeenCalled();
  });
});
