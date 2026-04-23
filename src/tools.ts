import type { Daemon } from './daemon.js';
import { pmlRowsToText, formatStdoutStderr, formatDynamicAnnotations } from './pml.js';
import type { Focus } from './models.js';

export const TOOL_DEFS = [
  {
    name: 'session_connect',
    description: 'Connect to a Pernosco trace by URL or trace ID. Opens the tab in Firefox if not already open.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Pernosco trace URL (https://pernos.co/debug/{TRACE_ID}/index.html) or bare trace ID' },
      },
      required: ['url'],
    },
  },
  {
    name: 'session_list',
    description: 'List available Pernosco traces (open Firefox tabs with pernos.co loaded)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_status',
    description: 'Get current focus position (event number, source file, line) for the connected session',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'session_disconnect',
    description: 'Disconnect from the current Pernosco session',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_executions',
    description: 'Find all calls to a function across the trace. Optionally evaluate C++ expressions at each call site using print_exprs (semicolon-delimited).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Fully qualified C++ function name, e.g. "nsDocShell::LoadURI"' },
        print_exprs: { type: 'string', description: 'Semicolon-delimited C++ expressions to evaluate at each call, e.g. "this->mURI.mRawPtr->mSpec; aLoadState->URI()->mSpec"' },
        limit: { type: 'number', description: 'Max results per direction (default 50)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'stack',
    description: 'Get the call stack at the current focus position',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'evaluate',
    description: 'Evaluate a C++ expression at the current focus position',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'C++ expression to evaluate, e.g. "this->mCount" or "aURI->mSpec"' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'goto',
    description: 'Navigate to a specific execution point by result index (from a previous query) or raw focus object',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Result index from the last query (1-based)' },
        focus: { type: 'object', description: 'Raw focus object with moment.event and moment.instr fields' },
      },
    },
  },
  {
    name: 'task_tree',
    description: 'Get the complete process/thread hierarchy for the trace',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search',
    description: 'Search for symbols, functions, or types by name',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term, e.g. "LoadURI" or "nsDocShell"' },
        max_results: { type: 'number', description: 'Maximum number of results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'watchpoint_history',
    description: 'Get complete write history for a memory address across the trace (reads all writes before and after current focus)',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Memory address in hex, e.g. "0x7fff1234abcd"' },
        type: { type: 'string', description: 'C++ type of the value, e.g. "uint64_t", "int32_t", "bool"' },
      },
      required: ['address', 'type'],
    },
  },
  {
    name: 'stdout_stderr',
    description: 'Get all stdout/stderr output across the trace. Results include event IDs — use goto(index) to navigate to where output was printed.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results per direction (default 200)' },
      },
    },
  },
  {
    name: 'current_tasks',
    description: 'Get active processes and threads at the current focus moment',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'notebook_read',
    description: 'Read Pernosco notebook annotations saved in this session',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_breakpoint_hits',
    description: 'Find all hits of a specific source line. Use when you have a file:line from a stack trace or crash report.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source file path or URL as it appears in Pernosco, e.g. "nsDocShell.cpp"' },
        line: { type: 'number', description: 'Line number (1-based)' },
        print_exprs: { type: 'string', description: 'Semicolon-delimited C++ expressions to evaluate at each hit' },
        limit: { type: 'number', description: 'Max results per direction (default 50)' },
      },
      required: ['file', 'line'],
    },
  },
  {
    name: 'dynamic_annotations',
    description: 'Show which lines of the current source file executed at the current focus, with execution counts for loops. Essential for understanding which code paths and branches ran.',
    inputSchema: {
      type: 'object',
      properties: {
        source_url: { type: 'string', description: 'Source URL to annotate (defaults to current focus source from session_status)' },
      },
    },
  },
];

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export async function handleToolCall(
  daemon: Daemon,
  clientId: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'session_connect': return await sessionConnect(daemon, clientId, args);
      case 'session_list': return sessionList(daemon);
      case 'session_status': return await sessionStatus(daemon, clientId);
      case 'session_disconnect': return sessionDisconnect(daemon, clientId);
      case 'find_executions': return await findExecutions(daemon, clientId, args);
      case 'stack': return await stackTool(daemon, clientId);
      case 'evaluate': return await evaluateTool(daemon, clientId, args);
      case 'goto': return await gotoTool(daemon, clientId, args);
      case 'task_tree': return await taskTreeTool(daemon, clientId);
      case 'search': return await searchTool(daemon, clientId, args);
      case 'watchpoint_history': return await watchpointHistory(daemon, clientId, args);
      case 'stdout_stderr': return await stdoutStderr(daemon, clientId, args);
      case 'current_tasks': return await currentTasks(daemon, clientId);
      case 'notebook_read': return await notebookRead(daemon, clientId);
      case 'find_breakpoint_hits': return await findBreakpointHits(daemon, clientId, args);
      case 'dynamic_annotations': return await dynamicAnnotations(daemon, clientId, args);
      default: return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function extractTraceId(urlOrId: string): string {
  const match = urlOrId.match(/\/debug\/([^/]+)\//);
  return match ? match[1] : urlOrId;
}

async function sessionConnect(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const url = String(args.url ?? '');
  const traceId = extractTraceId(url);

  if (!daemon.hasTab(traceId)) {
    const fullUrl = url.startsWith('http') ? url : `https://pernos.co/debug/${traceId}/index.html`;
    daemon.requestOpenTab(fullUrl);
    return ok(`Opening trace ${traceId} in Firefox. Call session_connect again once the tab has loaded.`);
  }

  daemon.bindClient(clientId, traceId);
  return ok(`Connected to Pernosco trace ${traceId}`);
}

function sessionList(daemon: Daemon): ToolResult {
  const traces = daemon.listTabs();
  if (traces.length === 0) {
    return ok('No Pernosco tabs open. Open a pernos.co/debug/* URL in Firefox.');
  }
  const lines = traces.map(t => `- ${t}  (https://pernos.co/debug/${t}/index.html)`);
  return ok(`Available Pernosco sessions:\n${lines.join('\n')}`);
}

async function sessionStatus(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const traceId = daemon.getClientTraceId(clientId);
  if (!traceId) {
    return err('No session connected. Call session_connect first.');
  }
  const backend = daemon.getBackend(clientId);
  const status = await backend.getStatus();
  const { event, instr } = status.focus.moment;
  const src = status.source
    ? ` at ${status.source.url.split('/').pop()}:${(status.source.pos as Record<string, number> | undefined)?.line ?? '?'}`
    : '';
  return ok(`Trace: ${traceId}\nFocus: event=${event}, instr=${instr}${src}`);
}

function sessionDisconnect(daemon: Daemon, clientId: string): ToolResult {
  const traceId = daemon.getClientTraceId(clientId);
  daemon.unbindClient(clientId);
  return ok(traceId ? `Disconnected from trace ${traceId}` : 'Not connected.');
}

async function findExecutions(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const symbol = String(args.symbol ?? '');
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const params: Record<string, unknown> = { symbol };
  if (args.print_exprs) params.print = String(args.print_exprs);
  const backend = daemon.getBackend(clientId);
  const rows = await backend.rangeQuery('execution', params, limit);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  const header = `Found ${count} call${count !== 1 ? 's' : ''} to ${symbol}:`;
  return ok(`${header}\n\n${pmlRowsToText(rows)}`);
}

async function stackTool(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('stack', {});
  daemon.storeQueryResults(clientId, rows);
  return ok(pmlRowsToText(rows));
}

async function evaluateTool(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const expression = String(args.expression ?? '');
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('evaluate', { payload: { expression } });
  return ok(pmlRowsToText(rows));
}

async function gotoTool(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  if (args.focus != null) {
    await backend.setFocus(args.focus as Focus);
    return ok('Navigation successful.');
  }
  if (typeof args.index === 'number') {
    const focus = daemon.getQueryFocus(clientId, args.index);
    if (!focus) return err(`No result at index ${args.index}. Run a query first.`);
    await backend.setFocus(focus);
    return ok(`Navigated to result [${args.index}].`);
  }
  return err('Provide either index (number) or focus (object) parameter.');
}

async function taskTreeTool(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('task-tree', {});
  return ok(pmlRowsToText(rows));
}

async function searchTool(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? '');
  const maxResults = typeof args.max_results === 'number' ? args.max_results : 20;
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('search', { input: query, maxResults });
  daemon.storeQueryResults(clientId, rows);
  return ok(pmlRowsToText(rows));
}

async function watchpointHistory(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const address = String(args.address ?? '');
  const type = String(args.type ?? '');
  const limit = typeof args.limit === 'number' ? args.limit : 100;
  const backend = daemon.getBackend(clientId);
  const rows = await backend.rangeQuery('watchpoint', { address, type }, limit);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  return ok(`${count} write${count !== 1 ? 's' : ''} to ${address} (${type}):\n\n${pmlRowsToText(rows)}`);
}

async function stdoutStderr(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = typeof args.limit === 'number' ? args.limit : 200;
  const backend = daemon.getBackend(clientId);
  const rows = await backend.rangeQuery('stdouterr', {}, limit);
  daemon.storeQueryResults(clientId, rows);
  return ok(formatStdoutStderr(rows));
}

async function currentTasks(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('current-tasks', {});
  return ok(pmlRowsToText(rows));
}

async function notebookRead(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const data = await backend.notebookRead();
  if (!data || typeof data !== 'object') {
    return ok('No notebook entries found.');
  }
  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([key]) => key.startsWith('notebook/'))
    .map(([, value]) => {
      const v = value as Record<string, unknown>;
      const created = v?.create as Record<string, unknown> | undefined;
      const item = created?.value as Record<string, unknown> | undefined;
      const focus = item?.focus as Record<string, unknown> | undefined;
      const moment = focus?.moment as { event: number; instr: number } | undefined;
      const text = typeof item?.text === 'string' ? item.text : null;
      const parts: string[] = [];
      if (moment) parts.push(`event=${moment.event}`);
      if (text) parts.push(`"${text}"`);
      return parts.join('  ') || JSON.stringify(value);
    });
  if (entries.length === 0) return ok('No notebook entries found.');
  return ok(`Notebook entries:\n${entries.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`);
}

async function findBreakpointHits(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const file = String(args.file ?? '');
  const line = typeof args.line === 'number' ? args.line : 0;
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const params: Record<string, unknown> = { url: file, points: [{ l: line, c: 0 }] };
  if (args.print_exprs) params.print = String(args.print_exprs);
  const backend = daemon.getBackend(clientId);
  const rows = await backend.rangeQuery('breakpoint', params, limit);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  return ok(`Found ${count} hit${count !== 1 ? 's' : ''} at ${file}:${line}:\n\n${pmlRowsToText(rows)}`);
}

async function dynamicAnnotations(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  let sourceUrl = typeof args.source_url === 'string' ? args.source_url : null;
  if (!sourceUrl) {
    const status = await backend.getStatus();
    sourceUrl = status.source?.url ?? null;
  }
  if (!sourceUrl) return err('No source URL available. Navigate to a source location first (use stack or goto), or provide source_url explicitly.');
  const rows = await backend.simpleQuery('dynamicAnnotations', { source: sourceUrl });
  const file = sourceUrl.split('/').pop() ?? sourceUrl;
  return ok(`Dynamic annotations for ${file}:\n\n${formatDynamicAnnotations(rows)}`);
}
