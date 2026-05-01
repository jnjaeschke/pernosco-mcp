import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MockExtension } from './mock_extension.js';

let daemon: Daemon;
let port: number;
let ext: MockExtension;

beforeAll(async () => {
  daemon = new Daemon();
  port = await daemon.start();
  ext = new MockExtension();
  await ext.connect(port);
  await new Promise(r => setTimeout(r, 100));
});

afterAll(async () => {
  ext.close();
  await daemon.shutdown();
});

describe('extension message routing', () => {
  it('getStatus routes through extension and returns', async () => {
    ext.registerTab('route-test-1', (type) => {
      if (type === 'getStatus') {
        return { focus: { moment: { event: 42, instr: 7 } }, source: { url: 'test.cpp', pos: { line: 10 } } };
      }
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    const backend = daemon.getTraceBackend('route-test-1');
    const status = await backend.getStatus();
    expect(status.focus.moment.event).toBe(42);
    expect(status.focus.moment.instr).toBe(7);
  });

  it('setFocus routes through extension', async () => {
    ext.registerTab('route-test-2', (type) => {
      if (type === 'setFocus') return { ok: true };
      if (type === 'getStatus') return { focus: { moment: { event: 1, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    const backend = daemon.getTraceBackend('route-test-2');
    await backend.setFocus({ moment: { event: 100, instr: 0 } });
  });

  it('rangeQuery returns result rows', async () => {
    const expectedRows = [
      { items: [{ focus: { moment: { event: 10, instr: 0 } }, pml: { t: 'inline', c: ['result'] } }] },
    ];
    ext.registerTab('route-test-3', (type) => {
      if (type === 'rangeQuery') return expectedRows;
      if (type === 'getStatus') return { focus: { moment: { event: 1, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    const backend = daemon.getTraceBackend('route-test-3');
    const rows = await backend.rangeQuery('execution', { symbol: 'test' });
    expect(rows).toHaveLength(1);
  });

  it('simpleQuery returns result rows', async () => {
    ext.registerTab('route-test-4', (type) => {
      if (type === 'simpleQuery') return [{ t: 'inline', c: ['stack frame'] }];
      if (type === 'getStatus') return { focus: { moment: { event: 1, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    const backend = daemon.getTraceBackend('route-test-4');
    const rows = await backend.simpleQuery('stack', {});
    expect(rows).toHaveLength(1);
  });

  it('query to closed tab rejects with error', async () => {
    ext.registerTab('route-test-5', () => []);
    await new Promise(r => setTimeout(r, 50));

    ext.closeTab('route-test-5');
    await new Promise(r => setTimeout(r, 50));

    expect(() => daemon.getTraceBackend('route-test-5')).toThrow('not found');
  });

  it('storageDump returns notebook data', async () => {
    const storageData = { 'notebook/123': { create: { value: { text: 'note' } } } };
    ext.registerTab('route-test-6', (type) => {
      if (type === 'storageDump') return storageData;
      if (type === 'getStatus') return { focus: { moment: { event: 1, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    const backend = daemon.getTraceBackend('route-test-6');
    const data = await backend.notebookRead();
    expect(data).toEqual(storageData);
  });

  it('extension reconnect re-registers existing tabs', async () => {
    ext.registerTab('persist-tab', (type) => {
      if (type === 'getStatus') return { focus: { moment: { event: 999, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    expect(daemon.hasTab('persist-tab')).toBe(true);

    ext.close();
    await new Promise(r => setTimeout(r, 100));

    const ext2 = new MockExtension();
    await ext2.connect(port);
    await new Promise(r => setTimeout(r, 100));

    ext2.registerTab('persist-tab', (type) => {
      if (type === 'getStatus') return { focus: { moment: { event: 999, instr: 0 } }, source: null };
      return [];
    });
    await new Promise(r => setTimeout(r, 50));

    expect(daemon.hasTab('persist-tab')).toBe(true);
    const backend = daemon.getTraceBackend('persist-tab');
    const status = await backend.getStatus();
    expect(status.focus.moment.event).toBe(999);

    // Update module-level ext for afterAll cleanup
    ext = ext2;
  });
});
