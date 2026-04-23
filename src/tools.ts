import type { Daemon } from './daemon.js';

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
