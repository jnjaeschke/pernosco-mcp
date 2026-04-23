import { WebSocket } from 'ws';
import { createInterface } from 'readline';

export async function runShim(port: number): Promise<void> {
  const clientId = crypto.randomUUID();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  ws.send(JSON.stringify({ type: 'register_shim', clientId }));

  // WS → stdout
  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'mcp_response') {
      process.stdout.write(JSON.stringify(msg.response) + '\n');
    }
  });

  ws.on('close', () => process.exit(0));
  ws.on('error', (err) => { console.error('pernosco-mcp: websocket error:', err.message); process.exit(1); });

  // stdin → WS
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request: unknown;
    try { request = JSON.parse(trimmed); } catch { return; }
    ws.send(JSON.stringify({ type: 'mcp_request', clientId, request }));
  });

  rl.on('close', () => ws.close());

  await new Promise<void>(resolve => ws.once('close', resolve));
}
