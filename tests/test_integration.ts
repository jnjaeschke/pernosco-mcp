import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { Daemon } from '../src/daemon.js';
import { MockExtension, makePmlRow } from './mock_extension.js';

let daemon: Daemon;
let port: number;
let ext: MockExtension;

async function shimCall(toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const clientId = crypto.randomUUID();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((r, e) => { ws.once('open', r); ws.once('error', e); });
  ws.send(JSON.stringify({ type: 'register_shim', clientId }));

  const initId = 1;
  ws.send(JSON.stringify({
    type: 'mcp_request', clientId,
    request: { jsonrpc: '2.0', id: initId, method: 'initialize', params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.1' },
    } },
  }));

  await new Promise<void>(resolve => {
    ws.on('message', function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'mcp_response' && msg.response?.id === initId) {
        ws.removeListener('message', handler);
        resolve();
      }
    });
  });

  ws.send(JSON.stringify({
    type: 'mcp_request', clientId,
    request: { jsonrpc: '2.0', method: 'notifications/initialized' },
  }));

  const callId = 2;
  ws.send(JSON.stringify({
    type: 'mcp_request', clientId,
    request: { jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: toolName, arguments: args } },
  }));

  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'mcp_response' && msg.response?.id === callId) {
        ws.close();
        resolve(msg.response.result);
      }
    });
  });
}

class PersistentShimClient {
  private ws!: WebSocket;
  private clientId = crypto.randomUUID();
  private nextId = 1;

  async connect(targetPort: number): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${targetPort}`);
    await new Promise<void>((r, e) => { this.ws.once('open', r); this.ws.once('error', e); });
    this.ws.send(JSON.stringify({ type: 'register_shim', clientId: this.clientId }));

    const initId = this.nextId++;
    this.ws.send(JSON.stringify({
      type: 'mcp_request', clientId: this.clientId,
      request: { jsonrpc: '2.0', id: initId, method: 'initialize', params: {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'test-persistent', version: '0.0.1' },
      } },
    }));

    await new Promise<void>(resolve => {
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'mcp_response' && msg.response?.id === initId) {
          this.ws.removeListener('message', handler);
          resolve();
        }
      };
      this.ws.on('message', handler);
    });

    this.ws.send(JSON.stringify({
      type: 'mcp_request', clientId: this.clientId,
      request: { jsonrpc: '2.0', method: 'notifications/initialized' },
    }));
  }

  async call(toolName: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const callId = this.nextId++;
    this.ws.send(JSON.stringify({
      type: 'mcp_request', clientId: this.clientId,
      request: { jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: toolName, arguments: args } },
    }));

    return new Promise(resolve => {
      const handler = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'mcp_response' && msg.response?.id === callId) {
          this.ws.removeListener('message', handler);
          resolve(msg.response.result);
        }
      };
      this.ws.on('message', handler);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('integration', () => {
  beforeAll(async () => {
    daemon = new Daemon();
    port = await daemon.start();

    ext = new MockExtension();
    await ext.connect(port);
    await new Promise(r => setTimeout(r, 100));

    ext.registerTab('test-trace-1', (type, payload) => {
      if (type === 'getStatus') {
        return {
          focus: { moment: { event: 500, instr: 10 } },
          source: { url: 'https://hg.mozilla.org/nsDocShell.cpp', pos: { line: 42 } },
        };
      }
      if (type === 'setFocus') return { ok: true };
      if (type === 'rangeQuery' || type === 'simpleQuery') {
        return [
          makePmlRow('nsDocShell::LoadURI(aURI)', 200, 5, { url: 'https://hg.mozilla.org/nsDocShell.cpp', line: 4521 }),
          makePmlRow('nsDocShell::LoadURI(aURI)', 300, 10, { url: 'https://hg.mozilla.org/nsDocShell.cpp', line: 4530 }),
        ];
      }
      return [];
    });
    await new Promise(r => setTimeout(r, 100));
  });

  afterAll(async () => {
    ext.close();
    await daemon.shutdown();
  });

  it('session_list shows registered tab', async () => {
    const result = await shimCall('session_list');
    const text = (result as any).content[0].text;
    expect(text).toContain('test-trace-1');
  });

  it('session_connect binds to trace', async () => {
    const result = await shimCall('session_connect', { url: 'test-trace-1' });
    const text = (result as any).content[0].text;
    expect(text).toContain('Connected');
    expect(text).toContain('test-trace-1');
  });

  it('session_connect waits for tab registration', async () => {
    setTimeout(() => ext.registerTab('delayed-trace', (type) => {
      if (type === 'getStatus') return { focus: { moment: { event: 1, instr: 0 } }, source: null };
      return [];
    }), 200);

    const result = await shimCall('session_connect', { url: 'delayed-trace' });
    const text = (result as any).content[0].text;
    expect(text).toContain('Connected');
    expect(text).toContain('delayed-trace');
  });

  it('find_executions returns error when not connected', async () => {
    const result = await shimCall('find_executions', { symbol: 'Foo' });
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('No session connected');
  });

  describe('multi-step workflow', () => {
    it('connect → find_executions → goto → session_status round-trip', async () => {
      const client = new PersistentShimClient();
      await client.connect(port);

      const connectResult = await client.call('session_connect', { url: 'test-trace-1' });
      expect((connectResult as any).content[0].text).toContain('Connected');

      const findResult = await client.call('find_executions', { symbol: 'nsDocShell::LoadURI' });
      expect((findResult as any).content[0].text).toContain('[1]');

      const gotoResult = await client.call('goto', { index: 1 });
      expect((gotoResult as any).isError).toBeUndefined();

      const statusResult = await client.call('session_status', {});
      expect((statusResult as any).content[0].text).toContain('test-trace-1');
      expect((statusResult as any).content[0].text).toContain('event=');

      client.close();
    });

    it('two clients on different traces are isolated', async () => {
      ext.registerTab('trace-A', (type) => {
        if (type === 'getStatus') return { focus: { moment: { event: 111, instr: 0 } }, source: null };
        return [];
      });
      ext.registerTab('trace-B', (type) => {
        if (type === 'getStatus') return { focus: { moment: { event: 222, instr: 0 } }, source: null };
        return [];
      });
      await new Promise(r => setTimeout(r, 100));

      const clientA = new PersistentShimClient();
      await clientA.connect(port);
      await clientA.call('session_connect', { url: 'trace-A' });

      const clientB = new PersistentShimClient();
      await clientB.connect(port);
      await clientB.call('session_connect', { url: 'trace-B' });

      const statusA = await clientA.call('session_status', {});
      expect((statusA as any).content[0].text).toContain('event=111');

      const statusB = await clientB.call('session_status', {});
      expect((statusB as any).content[0].text).toContain('event=222');

      clientA.close();
      clientB.close();
    });
  });
});
