import { WebSocket } from 'ws';
import type { PmlNode } from '../src/models.js';

type QueryHandler = (type: string, payload: Record<string, unknown>) => unknown;

export class MockExtension {
  private ws: WebSocket | null = null;
  private tabs = new Map<string, { traceId: string; onQuery?: QueryHandler }>();

  async connect(port: number): Promise<void> {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      this.ws!.once('open', resolve);
      this.ws!.once('error', reject);
    });
    this.ws.send(JSON.stringify({ type: 'register_extension' }));

    this.ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this.handleMessage(msg);
    });
  }

  registerTab(traceId: string, onQuery?: QueryHandler): void {
    this.tabs.set(traceId, { traceId, onQuery });
    this.send({ type: 'tabRegistered', traceId });
  }

  closeTab(traceId: string): void {
    this.tabs.delete(traceId);
    this.send({ type: 'tabClosed', traceId });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'listTabs': {
        const tabList = Array.from(this.tabs.values()).map(t => ({ traceId: t.traceId }));
        this.send({ type: 'tabList', replyId: msg.replyId, tabs: tabList });
        break;
      }

      case 'openTab':
        break;

      case 'rangeQuery':
      case 'simpleQuery':
      case 'getStatus':
      case 'setFocus':
      case 'storageDump': {
        const traceId = String(msg.traceId ?? '');
        const tab = this.tabs.get(traceId);
        const replyId = msg.replyId;
        if (tab?.onQuery) {
          try {
            const payload = msg.payload as Record<string, unknown>;
            const result = tab.onQuery(String(msg.type), payload);
            this.send({ type: 'reply', replyId, payload: result });
          } catch (err) {
            this.send({ type: 'reply', replyId, payload: null, extra: { error: String(err) } });
          }
        } else {
          this.send({ type: 'reply', replyId, payload: [] });
        }
        break;
      }
    }
  }
}

export function makePmlRow(text: string, event: number, instr = 0, source?: { url: string; line: number }): unknown {
  const pml: PmlNode = {
    t: 'block',
    c: [{ t: 'inline', c: [text] }],
  };
  if (source) {
    pml.a = { source: { url: source.url, pos: { line: source.line } } };
  }
  return { items: [{ focus: { moment: { event, instr } }, pml }] };
}
