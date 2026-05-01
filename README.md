# pernosco-mcp

MCP server that connects AI coding agents (Claude Code, etc.) to [Pernosco](https://pernos.co) debugging sessions. Query execution traces, inspect variables, navigate call stacks, and trace value histories — all through natural language.

## How It Works

```
Claude Code  <--stdio-->  pernosco-mcp daemon  <--WebSocket-->  Firefox extension  <--window.client-->  Pernosco
```

A background daemon coordinates between any number of Claude Code instances and Pernosco browser tabs. The Firefox extension bridges into Pernosco's internal `window.client` API. No public Pernosco API is required.

## Features

**20 debugging tools:**

| Tool | Description |
|------|-------------|
| `session_connect` | Connect to a Pernosco trace by URL or trace ID |
| `session_list` | List open Pernosco tabs |
| `session_status` | Current position (event, source file, line) |
| `session_disconnect` | Disconnect from current session |
| `find_executions` | Find all calls to a function, optionally evaluate expressions at each call |
| `stack` | Call stack at current position |
| `evaluate` | Evaluate a C++ expression |
| `goto` | Navigate to a query result or raw focus position |
| `task_tree` | Process/thread hierarchy |
| `search` | Search for symbols, functions, types |
| `watchpoint_history` | Complete write history for a memory address |
| `stdout_stderr` | All stdout/stderr output with event IDs |
| `current_tasks` | Active threads at current moment |
| `notebook_read` | Read Pernosco notebook annotations |
| `find_breakpoint_hits` | All hits of a source line |
| `dynamic_annotations` | Which lines executed at current focus, with counts |
| `source_read` | Read source code lines from the trace |
| `step_to_next_hit` | Navigate to next execution of current line |
| `step_to_prev_hit` | Navigate to previous execution of current line |
| `watch_variable` | Trace complete write history of a C++ variable |

**3 MCP resources:**

| Resource | Description |
|----------|-------------|
| `pernosco://guide` | Debugging guide — workflows and tips for AI agents |
| `pernosco://sessions` | List of open traces |
| `pernosco://sessions/{traceId}` | Current focus and source location |

## Requirements

- Node.js >= 24
- Firefox
- A Pernosco account with access to traces

## Installation

### 1. Build from Source

```bash
git clone <repo-url>
cd pernosco-mcp
npm install
cd extension && npm install && cd ..
npm run build:all
```

### 2. Register the Native Messaging Host

```bash
node scripts/postinstall.js
```

This writes the native messaging host manifest so Firefox can launch the daemon.

### 3. Load the Firefox Extension

1. In Firefox, go to `about:debugging` > "This Firefox" > "Load Temporary Add-on"
2. Select any file inside `extension/dist/` (e.g. `manifest.json`)

Temporary add-ons are removed on Firefox restart. Reload after each restart.

### 4. Configure Claude Code

```bash
claude mcp add pernosco -- node /absolute/path/to/pernosco-mcp/dist/cli.js
```

## Usage

1. Open a Pernosco trace in Firefox (`https://pernos.co/debug/{TRACE_ID}/index.html`)
1. In Claude Code, connect to the trace:
   > *"Connect to my Pernosco trace at https://pernos.co/debug/abc123/index.html"*
1. Debug:
   > *"Find all calls to nsDocShell::LoadURI and show me the URI argument at each call"*

   > *"Go to result 3 and show me the call stack"*

   > *"What was written to address 0x7fff1234abcd throughout the trace?"*

## Architecture

- **Daemon** (`src/daemon.ts`) — WebSocket server on a random localhost port. Coordinates shim clients and the extension. Spawned on-demand, exits after 10 minutes idle.
- **Shim** (`src/shim.ts`) — Thin stdio-to-WebSocket bridge. One per Claude Code instance.
- **Extension** (`extension/`) — Firefox extension with content script injected into pernos.co pages. Routes queries through Pernosco's `window.client` API.
- **Tools** (`src/tools.ts`) — MCP tool definitions and handlers.
- **PML Renderer** (`src/pml.ts`) — Converts Pernosco's PML output format to token-efficient text for LLM consumption.

## Development

### Scripts

```bash
npm run dev              # Watch mode (TypeScript)
npm test                 # Run all tests
npm run build            # Build server only
npm run build:extension  # Build extension .xpi
npm run build:all        # Build everything
```

## License

MIT
