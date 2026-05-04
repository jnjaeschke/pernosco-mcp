# pernosco-mcp

MCP server that connects AI coding agents (Claude Code, etc.) to [Pernosco](https://pernos.co) debugging sessions. Query execution traces, inspect variables, navigate call stacks, and trace value histories — all through natural language.

## How It Works

```
Claude Code  <--stdio-->  pernosco-mcp daemon  <--WebSocket-->  Firefox extension  <--window.client-->  Pernosco
```

A background daemon coordinates between any number of Claude Code instances and Pernosco browser tabs. The Firefox extension bridges into Pernosco's internal `window.client` API.

## Installation

### 1. Install the npm package

```bash
npm install -g pernosco-mcp
```

This installs the MCP server and registers the native messaging host for Firefox.

### 2. Install the Firefox extension

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/pernosco-mcp/).

### 3. Add to Claude Code

```bash
claude mcp add pernosco -- pernosco-mcp
```

## Usage

1. Open a Pernosco trace in Firefox
2. In Claude Code: *"Connect to my Pernosco trace at https://pernos.co/debug/abc123/index.html"*
3. Debug:
   - *"Find all calls to nsDocShell::LoadURI and show me the URI argument"*
   - *"Go to result 3 and show me the call stack"*
   - *"What was written to this address throughout the trace?"*

## Tools

| Tool | Description |
|------|-------------|
| `session_connect` | Connect to a trace by URL or trace ID |
| `session_list` | List open Pernosco tabs |
| `session_status` | Current position (event, source, line) |
| `session_disconnect` | Disconnect from session |
| `find_executions` | Find all calls to a function, optionally print expressions at each |
| `find_breakpoint_hits` | All hits of a source line |
| `stack` | Call stack at current position |
| `evaluate` | Evaluate a C++ expression |
| `goto` | Navigate to a query result or focus position |
| `search` | Search for symbols, functions, types |
| `watchpoint_history` | Write history for a memory address |
| `watch_variable` | Trace writes to a C++ variable (evaluate + watchpoint) |
| `stdout_stderr` | stdout/stderr output with event IDs |
| `source_read` | Read source code from the trace |
| `dynamic_annotations` | Which lines executed, with counts |
| `step_to_next_hit` | Step forward to next hit of current line |
| `step_to_prev_hit` | Step backward to previous hit |
| `task_tree` | Process/thread hierarchy |
| `current_tasks` | Active threads at current moment |
| `notebook_read` | Pernosco notebook annotations |

## Development

### Building from source

```bash
git clone https://github.com/jnjaeschke/pernosco-mcp.git
cd pernosco-mcp
npm install
npm run build:all
```

Load the extension manually via `about:debugging` > "This Firefox" > "Load Temporary Add-on" > select `extension/manifest.json`.

### Scripts

```bash
npm run dev              # Watch mode (TypeScript)
npm test                 # Run tests
npm run build            # Build server
npm run build:extension  # Package extension .xpi
npm run build:all        # Build everything
```

## Architecture

- **Daemon** (`src/daemon.ts`) — WebSocket server on random localhost port. Spawned on-demand, exits after 10 min idle.
- **Shim** (`src/shim.ts`) — stdio-to-WebSocket bridge, one per Claude Code instance.
- **Extension** (`extension/`) — Content script injected into pernos.co pages, queries `window.client` API.
- **PML** (`src/pml.ts`) — Converts Pernosco's markup to text for LLM consumption.

## License

MIT
