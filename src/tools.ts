import type { Daemon } from './daemon.js';
import { pmlRowsToText, formatStdoutStderr, formatDynamicAnnotations, formatStack, asItemsRow, filterNavigableRows } from './pml.js';
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
    description: 'Get stdout/stderr output around the current focus position. Output is scoped to the current process — use goto to navigate to a content process first if needed. Results include event IDs for navigation.',
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
  {
    name: 'source_read',
    description: 'Read source code lines from the current trace. Use after stack or session_status to see code around the current position.',
    inputSchema: {
      type: 'object',
      properties: {
        source_url: { type: 'string', description: 'Source URL as it appears in Pernosco (from stack or session_status output). If omitted, uses current focus source.' },
        start_line: { type: 'number', description: 'First line to read (1-based, default: 1)' },
        end_line: { type: 'number', description: 'Last line to read (inclusive). Defaults to start_line + 50.' },
      },
    },
  },
  {
    name: 'step_to_next_hit',
    description: 'Navigate forward to the next execution of the current source line (or a specified line). Useful for stepping through loop iterations or repeated calls.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source file (defaults to current focus source)' },
        line: { type: 'number', description: 'Line number (defaults to current focus line)' },
      },
    },
  },
  {
    name: 'watch_variable',
    description: 'Get the complete write history of a C++ variable. Evaluates the expression to find its memory address, then traces all writes. Simpler than manually using evaluate + watchpoint_history.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'C++ expression for the variable, e.g. "this->mURI" or "aLoadState"' },
        type: { type: 'string', description: 'C++ type of the value, e.g. "uint64_t", "int32_t", "nsCOMPtr<nsIURI>"' },
        limit: { type: 'number', description: 'Max results per direction (default 100)' },
      },
      required: ['expression', 'type'],
    },
  },
  {
    name: 'step_to_prev_hit',
    description: 'Navigate backward to the previous execution of the current source line (or a specified line). Useful for reverse debugging.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source file (defaults to current focus source)' },
        line: { type: 'number', description: 'Line number (defaults to current focus line)' },
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
      case 'source_read': return await sourceRead(daemon, clientId, args);
      case 'watch_variable': return await watchVariable(daemon, clientId, args);
      case 'step_to_next_hit': return await stepToHit(daemon, clientId, args, 'next');
      case 'step_to_prev_hit': return await stepToHit(daemon, clientId, args, 'prev');
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

function requireString(args: Record<string, unknown>, key: string, label: string): string {
  const val = typeof args[key] === 'string' ? (args[key] as string).trim() : '';
  if (!val) throw new Error(`${label} is required`);
  return val;
}

function requirePositiveInt(args: Record<string, unknown>, key: string, label: string): number {
  const val = typeof args[key] === 'number' ? args[key] as number : 0;
  if (val < 1) throw new Error(`${label} must be a positive integer`);
  return val;
}

function extractTraceId(urlOrId: string): string {
  const match = urlOrId.match(/\/debug\/([^/?#]+)/);
  return match ? match[1] : urlOrId;
}

async function sessionConnect(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const url = String(args.url ?? '');
  const traceId = extractTraceId(url);

  if (!daemon.hasTab(traceId)) {
    // Wait briefly — extension may still be registering existing tabs
    const alreadyOpen = await daemon.waitForTab(traceId, 3000);
    if (!alreadyOpen) {
      const fullUrl = url.startsWith('http') ? url : `https://pernos.co/debug/${traceId}/index.html`;
      daemon.requestOpenTab(fullUrl);
      const loaded = await daemon.waitForTab(traceId);
      if (!loaded) {
        return err(`Timed out waiting for trace ${traceId} to load in Firefox. Is the Pernosco tab open?`);
      }
    }
  }

  daemon.bindClient(clientId, traceId);
  try {
    const backend = daemon.getBackend(clientId);
    await backend.getStatus();
  } catch (e) {
    daemon.unbindClient(clientId);
    return err(`Tab for trace ${traceId} found but not responding: ${e instanceof Error ? e.message : String(e)}. Is the Pernosco session fully loaded?`);
  }
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
  daemon.cleanupClient(clientId);
  return ok(traceId ? `Disconnected from trace ${traceId}` : 'Not connected.');
}

async function findExecutions(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const symbol = requireString(args, 'symbol', 'Symbol');
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const params: Record<string, unknown> = { symbol };
  if (args.print_exprs) params.print = String(args.print_exprs);
  const backend = daemon.getBackend(clientId);
  const allRows = await backend.rangeQuery('execution', params, limit);
  const rows = filterNavigableRows(allRows);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  const header = `Found ${count} call${count !== 1 ? 's' : ''} to ${symbol}:`;
  return ok(`${header}\n\n${pmlRowsToText(rows)}`);
}

async function stackTool(daemon: Daemon, clientId: string): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('stack', {});
  daemon.storeQueryResults(clientId, rows);
  return ok(formatStack(rows));
}

async function evaluateTool(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const expression = requireString(args, 'expression', 'Expression');
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('evaluate', { payload: { expression } });
  daemon.storeQueryResults(clientId, rows);
  if (rows.length === 0) {
    return err(`No result for "${expression}". Possible causes: no debug info at current position, expression not in scope, or optimized out. Try navigating to a function entry point first (use find_executions + goto).`);
  }
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
  const query = requireString(args, 'query', 'Query');
  const maxResults = typeof args.max_results === 'number' ? args.max_results : 20;
  const backend = daemon.getBackend(clientId);
  const rows = await backend.simpleQuery('search', { input: query, maxResults });
  daemon.storeQueryResults(clientId, rows);
  return ok(pmlRowsToText(rows));
}

async function watchpointHistory(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const address = requireString(args, 'address', 'Address');
  const type = requireString(args, 'type', 'Type');
  const limit = typeof args.limit === 'number' ? args.limit : 100;
  const backend = daemon.getBackend(clientId);
  const allRows = await backend.rangeQuery('watchpoint', { address, type }, limit);
  const rows = filterNavigableRows(allRows);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  return ok(`${count} write${count !== 1 ? 's' : ''} to ${address} (${type}):\n\n${pmlRowsToText(rows)}`);
}

async function stdoutStderr(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = typeof args.limit === 'number' ? args.limit : 200;
  const backend = daemon.getBackend(clientId);
  const allRows = await backend.rangeQuery('stdouterr', {}, limit);
  const rows = filterNavigableRows(allRows);
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
      if (value == null || typeof value !== 'object') return null;
      const v = value as Record<string, unknown>;
      const created = v?.create as Record<string, unknown> | undefined;
      const item = created?.value as Record<string, unknown> | undefined;
      if (!item) return null;
      const focus = item?.focus as Record<string, unknown> | undefined;
      const moment = focus?.moment as { event: number; instr: number } | undefined;
      const text = typeof item?.text === 'string' ? item.text : null;
      const parts: string[] = [];
      if (moment) parts.push(`event=${moment.event}`);
      if (text) parts.push(`"${text}"`);
      return parts.length > 0 ? parts.join('  ') : null;
    })
    .filter((e): e is string => e !== null);
  if (entries.length === 0) return ok('No notebook entries found.');
  return ok(`Notebook entries:\n${entries.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`);
}

async function findBreakpointHits(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const file = requireString(args, 'file', 'File');
  const line = requirePositiveInt(args, 'line', 'Line');
  const limit = typeof args.limit === 'number' ? args.limit : 50;
  const params: Record<string, unknown> = { url: file, points: [{ l: line, c: 0 }] };
  if (args.print_exprs) params.print = String(args.print_exprs);
  const backend = daemon.getBackend(clientId);
  const allRows = await backend.rangeQuery('breakpoint', params, limit);
  const rows = filterNavigableRows(allRows);
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
  daemon.storeQueryResults(clientId, rows);
  const file = sourceUrl.split('/').pop() ?? sourceUrl;
  return ok(`Dynamic annotations for ${file}:\n\n${formatDynamicAnnotations(rows)}`);
}

async function sourceRead(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  let sourceUrl = typeof args.source_url === 'string' ? args.source_url : null;
  if (!sourceUrl) {
    const status = await backend.getStatus();
    sourceUrl = status.source?.url ?? null;
  }
  if (!sourceUrl) return err('No source URL available. Navigate to a source location first, or provide source_url.');

  const startLine = typeof args.start_line === 'number' ? args.start_line : 1;
  const endLine = typeof args.end_line === 'number' ? args.end_line : startLine + 50;

  const result = await backend.getSource(sourceUrl, startLine, endLine);
  const file = sourceUrl.split('/').pop() ?? sourceUrl;
  const numbered = result.lines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
  return ok(`${file} (lines ${startLine}-${startLine + result.lines.length - 1}):\n\n${numbered}`);
}

async function watchVariable(daemon: Daemon, clientId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const expression = requireString(args, 'expression', 'Expression');
  const type = requireString(args, 'type', 'Type');
  const limit = typeof args.limit === 'number' ? args.limit : 100;

  const backend = daemon.getBackend(clientId);

  const evalRows = await backend.simpleQuery('evaluate', { payload: { expression: `&(${expression})` } });
  const addrText = pmlRowsToText(evalRows).trim();
  const addrMatch = addrText.match(/0x[0-9a-fA-F]+/);
  if (!addrMatch) {
    return err(`Could not determine address of "${expression}". Evaluate result: ${addrText}`);
  }
  const address = addrMatch[0];

  const allRows = await backend.rangeQuery('watchpoint', { address, type }, limit);
  const rows = filterNavigableRows(allRows);
  daemon.storeQueryResults(clientId, rows);
  const count = rows.length;
  return ok(`${count} write${count !== 1 ? 's' : ''} to ${expression} (${type} at ${address}):\n\n${pmlRowsToText(rows)}`);
}

async function stepToHit(daemon: Daemon, clientId: string, args: Record<string, unknown>, direction: 'next' | 'prev'): Promise<ToolResult> {
  const backend = daemon.getBackend(clientId);
  const status = await backend.getStatus();
  const currentMoment = status.focus.moment;

  let file = typeof args.file === 'string' ? args.file : null;
  let line = typeof args.line === 'number' ? args.line : null;

  if (!file || !line) {
    if (!status.source?.url) return err('No source location at current focus. Provide file and line explicitly.');
    file = file ?? status.source.url;
    line = line ?? (status.source.pos as Record<string, number> | undefined)?.line ?? null;
    if (!line) return err('Cannot determine current line. Provide line explicitly.');
  }

  const params: Record<string, unknown> = { url: file, points: [{ l: line, c: 0 }] };
  const allRows = await backend.rangeQuery('breakpoint', params, 50);
  const rows = filterNavigableRows(allRows);
  daemon.storeQueryResults(clientId, rows);

  const candidates = rows
    .map((row, i) => {
      const itemsRow = asItemsRow(row);
      const moment = itemsRow?.items[0]?.focus?.moment;
      return moment ? { index: i, moment } : null;
    })
    .filter((c): c is { index: number; moment: { event: number; instr: number } } => c !== null);

  let target: typeof candidates[number] | null = null;

  if (direction === 'next') {
    target = candidates.find(c =>
      c.moment.event > currentMoment.event ||
      (c.moment.event === currentMoment.event && c.moment.instr > currentMoment.instr)
    ) ?? null;
  } else {
    target = [...candidates].reverse().find(c =>
      c.moment.event < currentMoment.event ||
      (c.moment.event === currentMoment.event && c.moment.instr < currentMoment.instr)
    ) ?? null;
  }

  if (!target) {
    const dirLabel = direction === 'next' ? 'later' : 'earlier';
    return ok(`No ${dirLabel} hit of ${(typeof file === 'string' ? file : '').split('/').pop()}:${line} found in the trace.`);
  }

  const focusRow = rows[target.index];
  const itemsRow = asItemsRow(focusRow);
  const focusObj = itemsRow?.items[0]?.focus;
  if (!focusObj) return err('Internal error: hit has no focus');

  await backend.setFocus(focusObj);
  const { event, instr } = target.moment;
  return ok(`Stepped ${direction} to event=${event}, instr=${instr} at ${(typeof file === 'string' ? file : '').split('/').pop()}:${line} [${target.index + 1}/${rows.length}]`);
}
