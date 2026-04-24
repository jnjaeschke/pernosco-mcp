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

  it('session_connect with unknown trace requests tab open', async () => {
    const result = await shimCall('session_connect', { url: 'unknown-trace' });
    const text = (result as any).content[0].text;
    expect(text).toContain('Opening');
  });

  it('find_executions returns error when not connected', async () => {
    const result = await shimCall('find_executions', { symbol: 'Foo' });
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain('No session connected');
  });
});
