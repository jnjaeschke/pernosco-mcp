import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import { CONFIG_DIR, SERVER_JSON } from './spawn.js';
import { TOOL_DEFS, handleToolCall } from './tools.js';
import { VERSION } from './version.js';
import { ConnectionError, SessionNotConnected, TraceNotFound, QueryTimeout, QueryError } from './errors.js';
import type { PernoscoBackend } from './backend.js';
import type { Focus, PmlRow, SessionStatus } from './models.js';
import { asItemsRow } from './pml.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const QUERY_TIMEOUT_MS = 30_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueryTimeout(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── ShimTransport ─────────────────────────────────────────────────────────

class ShimTransport implements Transport {
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  constructor(private ws: WebSocket, private clientId: string) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'mcp_response', clientId: this.clientId, response: message }));
    }
  }

  async close(): Promise<void> {}

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

// ─── ExtensionBackend ───────────────────────────────────────────────────────

class ExtensionBackend implements PernoscoBackend {
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private counter = 0;

  constructor(private daemon: Daemon, public readonly traceId: string) {}

  private sendToDaemon(msg: Record<string, unknown>): void {
    this.daemon.sendToExtension(msg);
  }

  private query<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    // Embed traceId in replyId (separator "::" can't appear in trace IDs)
    const replyId = `${this.traceId}::r${this.counter++}`;
    const inner = new Promise<T>((resolve, reject) => {
      this.pending.set(replyId, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.sendToDaemon({ type, traceId: this.traceId, replyId, payload });
    return withTimeout(inner, QUERY_TIMEOUT_MS, type).catch(err => {
      this.pending.delete(replyId);
      throw err;
    });
  }

  handleReply(replyId: string, payload: unknown): void {
    const p = this.pending.get(replyId);
    if (p) {
      this.pending.delete(replyId);
      p.resolve(payload);
    }
  }

  handleError(replyId: string, error: Error): void {
    const p = this.pending.get(replyId);
    if (p) {
      this.pending.delete(replyId);
      p.reject(error);
    }
  }

  rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  rangeQuery(name: string, params: Record<string, unknown>, limit = 50): Promise<PmlRow[]> {
    return this.query('rangeQuery', { name, limit, mixArgs: { params } });
  }

  simpleQuery(name: string, mixArgs: Record<string, unknown>): Promise<PmlRow[]> {
    return this.query('simpleQuery', { name, mixArgs });
  }

  async setFocus(focus: Focus): Promise<void> {
    await this.query<{ ok: boolean }>('setFocus', { focus });
  }

  async getStatus(): Promise<SessionStatus> {
    return this.query<SessionStatus>('getStatus', {});
  }

  async close(): Promise<void> {
    this.rejectAll(new ConnectionError('Backend closed'));
  }

  notebookRead(): Promise<unknown> {
    return this.query<unknown>('storageDump', {});
  }
}

// ─── ClientSession ──────────────────────────────────────────────────────────

interface ClientSession {
  ws: WebSocket;
  transport: ShimTransport;
  server: Server;
  traceId: string | null;
}

// ─── Daemon ─────────────────────────────────────────────────────────────────

export class Daemon {
  private clients = new Map<string, ClientSession>();
  private backends = new Map<string, ExtensionBackend>();
  private extensionWs: WebSocket | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResults = new Map<string, PmlRow[]>();
  private wss!: WebSocketServer;

  async start(): Promise<number> {
    const httpServer = createServer(this.handleHttp.bind(this));
    this.wss = new WebSocketServer({ server: httpServer });
    this.wss.on('connection', this.handleConnection.bind(this));

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address() as { port: number };
    const port = addr.port;

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(SERVER_JSON, JSON.stringify({ port, pid: process.pid }));

    this.resetIdleTimer();
    return port;
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  }

  private handleConnection(ws: WebSocket): void {
    this.resetIdleTimer();
    ws.once('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()); } catch { ws.close(); return; }

      if (msg.type === 'register_shim') {
        this.handleShimConnect(ws, String(msg.clientId ?? crypto.randomUUID()));
      } else if (msg.type === 'register_extension') {
        this.handleExtensionConnect(ws);
      } else {
        ws.close();
      }
    });
  }

  private handleShimConnect(ws: WebSocket, clientId: string): void {
    const transport = new ShimTransport(ws, clientId);
    const server = new Server(
      { name: 'pernosco-mcp', version: VERSION },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      return handleToolCall(this, clientId, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    });

    const session: ClientSession = { ws, transport, server, traceId: null };
    this.clients.set(clientId, session);

    server.connect(transport).catch(e => {
      console.error('MCP server error', clientId, e);
    });

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'mcp_request') {
        transport.receive(msg.request as JSONRPCMessage);
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      transport.onclose?.();
      this.resetIdleTimer();
    });
  }

  private handleExtensionConnect(ws: WebSocket): void {
    if (this.extensionWs) {
      try { this.extensionWs.close(); } catch {}
      for (const backend of this.backends.values()) {
        backend.rejectAll(new ConnectionError('Extension reconnected'));
      }
      this.backends.clear();
    }
    this.extensionWs = ws;

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this.handleExtensionMessage(msg);
    });

    ws.on('close', () => {
      if (this.extensionWs === ws) {
        this.extensionWs = null;
        for (const backend of this.backends.values()) {
          backend.rejectAll(new ConnectionError('Extension disconnected'));
        }
      }
      this.resetIdleTimer();
    });

    ws.send(JSON.stringify({ type: 'listTabs', replyId: 'startup-list' }));
  }

  private handleExtensionMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'tabList': {
        const tabs = (msg.tabs as Array<{ traceId: string }> | undefined) ?? [];
        for (const { traceId } of tabs) {
          if (!this.backends.has(traceId)) {
            this.backends.set(traceId, new ExtensionBackend(this, traceId));
          }
        }
        break;
      }
      case 'reply': {
        const replyId = String(msg.replyId ?? '');
        if (replyId === 'startup-list') return;
        // replyId format: "{traceId}::r{N}" — extract traceId from prefix
        const sep = replyId.indexOf('::r');
        if (sep !== -1) {
          const traceId = replyId.slice(0, sep);
          const backend = this.backends.get(traceId);
          if (backend) {
            const extra = msg.extra as Record<string, unknown> | undefined;
            if (extra?.error) {
              backend.handleError(replyId, new QueryError(String(extra.error)));
            } else {
              backend.handleReply(replyId, msg.payload);
            }
          }
        }
        break;
      }
      case 'tabRegistered': {
        const traceId = String(msg.traceId);
        if (!this.backends.has(traceId)) {
          this.backends.set(traceId, new ExtensionBackend(this, traceId));
        }
        break;
      }
      case 'tabClosed': {
        const traceId = String(msg.traceId);
        this.backends.get(traceId)?.rejectAll(new ConnectionError('Tab closed'));
        this.backends.delete(traceId);
        break;
      }
    }
  }

  sendToExtension(msg: Record<string, unknown>): void {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
      throw new ConnectionError('No extension connected');
    }
    this.extensionWs.send(JSON.stringify(msg));
  }

  getBackend(clientId: string): PernoscoBackend {
    const session = this.clients.get(clientId);
    if (!session?.traceId) throw new SessionNotConnected();
    const backend = this.backends.get(session.traceId);
    if (!backend) throw new TraceNotFound(session.traceId);
    return backend;
  }

  bindClient(clientId: string, traceId: string): void {
    const session = this.clients.get(clientId);
    if (session) session.traceId = traceId;
  }

  unbindClient(clientId: string): void {
    const session = this.clients.get(clientId);
    if (session) session.traceId = null;
  }

  getClientTraceId(clientId: string): string | null {
    return this.clients.get(clientId)?.traceId ?? null;
  }

  listTabs(): string[] {
    return Array.from(this.backends.keys());
  }

  storeQueryResults(clientId: string, rows: PmlRow[]): void {
    this.lastResults.set(clientId, rows);
  }

  getQueryFocus(clientId: string, index: number): Focus | null {
    const rows = this.lastResults.get(clientId);
    if (!rows) return null;
    const row = rows[index - 1];
    if (row == null) return null;
    const itemsRow = asItemsRow(row);
    return itemsRow?.items[0]?.focus ?? null;
  }

  hasTab(traceId: string): boolean {
    return this.backends.has(traceId);
  }

  requestOpenTab(url: string): void {
    this.sendToExtension({ type: 'openTab', url });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const totalConnections = this.clients.size + (this.extensionWs ? 1 : 0);
    if (totalConnections === 0) {
      this.idleTimer = setTimeout(() => process.exit(0), IDLE_TIMEOUT_MS);
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('daemon.js')) {
  const daemon = new Daemon();
  daemon.start().then(port => {
    console.log(`pernosco-mcp daemon listening on port ${port}`);
  }).catch(e => {
    console.error('Daemon start failed:', e);
    process.exit(1);
  });
}
