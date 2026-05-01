import { WebSocket } from 'ws';
import { createInterface, type Interface } from 'readline';
import { detectOrSpawn } from './spawn.js';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

export async function runShim(): Promise<void> {
  let attempts = 0;
  let rl: Interface | null = null;

  while (attempts < MAX_RECONNECT_ATTEMPTS) {
    try {
      const port = await detectOrSpawn();
      const clientId = crypto.randomUUID();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });

      ws.send(JSON.stringify({ type: 'register_shim', clientId }));
      attempts = 0;

      ws.on('message', (data) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.type === 'mcp_response') {
          process.stdout.write(JSON.stringify(msg.response) + '\n');
        }
      });

      if (!rl) {
        rl = createInterface({ input: process.stdin, terminal: false });
        rl.on('close', () => {
          ws.close();
          process.exit(0);
        });
      }

      const sendToWs = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let request: unknown;
        try { request = JSON.parse(trimmed); } catch { return; }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'mcp_request', clientId, request }));
        }
      };

      rl.removeAllListeners('line');
      rl.on('line', sendToWs);

      await new Promise<void>((resolve) => {
        ws.on('close', resolve);
        ws.on('error', () => resolve());
      });

      attempts++;
      if (attempts < MAX_RECONNECT_ATTEMPTS) {
        console.error(`pernosco-mcp: daemon connection lost, reconnecting (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
      }
    } catch (e) {
      attempts++;
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        throw e;
      }
      console.error(`pernosco-mcp: connection failed, retrying (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
    }
  }

  console.error('pernosco-mcp: max reconnection attempts reached, exiting');
  process.exit(1);
}
