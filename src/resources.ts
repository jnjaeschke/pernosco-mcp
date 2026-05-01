import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Daemon } from './daemon.js';

const GUIDE = `# Pernosco MCP Debugging Guide

## Quick Start
1. session_connect(url) — connect to a Pernosco trace
2. session_status() — see current position (event, source file, line)
3. find_executions(symbol) — find all calls to a function
4. goto(index) — navigate to a result from the last query
5. stack() — get call stack at current position
6. evaluate(expression) — evaluate C++ expression

## Workflows

### Find root cause of a bug
1. find_executions or find_breakpoint_hits to locate relevant code
2. goto to navigate to a specific call
3. stack to see context
4. evaluate to inspect variables
5. watchpoint_history to trace value changes

### Understand control flow
1. dynamic_annotations to see which lines executed and how many times
2. find_breakpoint_hits on key lines to see all hits
3. stdout_stderr to correlate with output

### Navigate the trace
- goto(index) — jump to result from last query (1-based)
- goto(focus) — jump to raw {moment: {event, instr}} position
- Results from find_executions, find_breakpoint_hits, watchpoint_history, stdout_stderr are navigable

## Tips
- Use print_exprs in find_executions/find_breakpoint_hits to evaluate expressions at each hit
- session_status shows current position — use after goto to confirm navigation
- task_tree shows all processes/threads — use to find the right context
- current_tasks shows threads active at current moment
`;

export function registerResources(server: Server, daemon: Daemon, clientId: string): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<{ uri: string; name: string; description: string; mimeType: string }> = [
      {
        uri: 'pernosco://guide',
        name: 'Pernosco debugging guide',
        description: 'How to use Pernosco MCP tools effectively',
        mimeType: 'text/markdown',
      },
      {
        uri: 'pernosco://sessions',
        name: 'Open sessions',
        description: 'List of open Pernosco traces',
        mimeType: 'application/json',
      },
    ];

    const traceId = daemon.getClientTraceId(clientId);
    if (traceId) {
      resources.push({
        uri: `pernosco://sessions/${traceId}`,
        name: `Session ${traceId}`,
        description: `Current state of trace ${traceId}`,
        mimeType: 'application/json',
      });
    }

    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;

    if (uri === 'pernosco://guide') {
      return { contents: [{ uri, mimeType: 'text/markdown', text: GUIDE }] };
    }

    if (uri === 'pernosco://sessions') {
      const tabs = daemon.listTabs();
      const text = JSON.stringify(tabs.map(t => ({
        traceId: t,
        url: `https://pernos.co/debug/${t}/index.html`,
      })));
      return { contents: [{ uri, mimeType: 'application/json', text }] };
    }

    if (uri.startsWith('pernosco://sessions/')) {
      const traceId = uri.replace('pernosco://sessions/', '');
      const backend = daemon.getTraceBackend(traceId);
      const status = await backend.getStatus();
      const { event, instr } = status.focus.moment;
      const src = status.source;
      const file = src?.url?.split('/').pop() ?? null;
      const line = (src?.pos as Record<string, number> | undefined)?.line ?? null;
      const text = JSON.stringify({
        traceId,
        focus: { event, instr },
        source: file && line ? `${file}:${line}` : null,
      });
      return { contents: [{ uri, mimeType: 'application/json', text }] };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });
}
