import { describe, it, expect } from 'vitest';
import { pmlToText, pmlRowsToText, formatStdoutStderr, formatDynamicAnnotations, asItemsRow, asPmlNode, formatStack } from '../src/pml.js';
import type { PmlNode } from '../src/models.js';

describe('pmlToText', () => {
  it('renders a string child directly', () => {
    const node: PmlNode = { t: 'inline', c: ['hello'] };
    expect(pmlToText(node)).toBe('hello');
  });

  it('concatenates multiple string children', () => {
    const node: PmlNode = { t: 'inline', c: ['foo', 'bar'] };
    expect(pmlToText(node)).toBe('foobar');
  });

  it('recursively renders nested nodes', () => {
    const node: PmlNode = {
      t: 'inline',
      c: [
        { t: 'inline', c: ['inner'] },
        ' tail',
      ],
    };
    expect(pmlToText(node)).toBe('inner tail');
  });

  it('block joins top-level children with newlines', () => {
    const node: PmlNode = {
      t: 'block',
      c: [
        { t: 'inline', c: ['line1'] },
        { t: 'inline', c: ['line2'] },
      ],
    };
    expect(pmlToText(node)).toBe('line1\nline2');
  });

  it('renders ident node using name from children', () => {
    const node: PmlNode = { t: 'ident', c: ['myFunction'] };
    expect(pmlToText(node)).toBe('myFunction');
  });

  it('renders number node', () => {
    const node: PmlNode = { t: 'number', c: ['42'] };
    expect(pmlToText(node)).toBe('42');
  });

  it('renders str node with quotes', () => {
    const node: PmlNode = { t: 'str', c: ['"hello world"'] };
    expect(pmlToText(node)).toBe('"hello world"');
  });

  it('handles null/undefined node gracefully', () => {
    expect(pmlToText(null as unknown as PmlNode)).toBe('');
    expect(pmlToText(undefined as unknown as PmlNode)).toBe('');
  });

  it('skips null children', () => {
    const node: PmlNode = { t: 'inline', c: [null as unknown as string, 'text'] };
    expect(pmlToText(node)).toBe('text');
  });
});

describe('pmlRowsToText', () => {
  it('formats multiple rows with indices', () => {
    const rows = [
      { pml: { t: 'inline', c: ['fn()'] } },
      { pml: { t: 'inline', c: ['fn2()'] } },
    ];
    const text = pmlRowsToText(rows as unknown[]);
    expect(text).toContain('[1]');
    expect(text).toContain('[2]');
    expect(text).toContain('fn()');
    expect(text).toContain('fn2()');
  });

  it('handles empty rows', () => {
    expect(pmlRowsToText([])).toBe('No results.');
  });

  it('handles raw array rows (not wrapped in {pml:...})', () => {
    const rows = [{ t: 'inline', c: ['raw'] }];
    const text = pmlRowsToText(rows as unknown[]);
    expect(text).toContain('raw');
  });
});

describe('pmlRowsToText with PmlItemRow', () => {
  it('extracts pml from items wrapper', () => {
    const rows = [
      { items: [{ focus: { moment: { event: 200, instr: 10 } }, pml: { t: 'inline', c: ['nsDocShell::LoadURI(...)'] } }] },
      { items: [{ focus: { moment: { event: 300, instr: 20 } }, pml: { t: 'inline', c: ['nsDocShell::LoadURI(...)'] } }] },
    ];
    const text = pmlRowsToText(rows as unknown[]);
    expect(text).toContain('[1]');
    expect(text).toContain('nsDocShell::LoadURI');
    expect(text).toContain('e=200');
    expect(text).not.toContain('"items"');
  });

  it('shows source location from pml attributes', () => {
    const rows = [
      { items: [{ focus: { moment: { event: 100, instr: 5 } }, pml: {
        t: 'block', a: { source: { url: 'https://hg.mozilla.org/nsDocShell.cpp', pos: { line: 4521 } } },
        c: [{ t: 'inline', c: ['nsDocShell::LoadURI(aURI)'] }]
      } }] },
    ];
    const text = pmlRowsToText(rows as unknown[]);
    expect(text).toContain('nsDocShell.cpp:4521');
    expect(text).toContain('e=100');
  });

  it('handles rows without focus gracefully', () => {
    const rows = [{ pml: { t: 'inline', c: ['hello'] } }];
    const text = pmlRowsToText(rows as unknown[]);
    expect(text).toContain('hello');
    expect(text).not.toContain('undefined');
  });
});

describe('formatStdoutStderr', () => {
  it('shows event number and text content', () => {
    const rows = [
      { items: [{ focus: { moment: { event: 100, instr: 5 } }, pml: { t: 'inline', c: ['hello\n'] } }] },
      { items: [{ focus: { moment: { event: 200, instr: 3 } }, pml: { t: 'inline', c: ['world\n'] } }] },
    ];
    const text = formatStdoutStderr(rows as unknown[]);
    expect(text).toContain('[1] event=100');
    expect(text).toContain('hello');
    expect(text).toContain('[2] event=200');
    expect(text).toContain('world');
  });

  it('handles empty rows', () => {
    expect(formatStdoutStderr([])).toBe('No output found.');
  });
});

describe('formatDynamicAnnotations', () => {
  it('shows executed lines with counts', () => {
    const rows = [
      { lineNumber: 100, count: 1, strength: 'strong' },
      { lineNumber: 101, count: 5, strength: 'strong' },
      { lineNumber: 102, count: 0, strength: 'none' },
    ];
    const text = formatDynamicAnnotations(rows as unknown[]);
    expect(text).toContain('100');
    expect(text).toContain('101');
    expect(text).toContain('5×');
    expect(text).toContain('102');
    expect(text).toContain('not executed');
  });

  it('handles empty rows', () => {
    expect(formatDynamicAnnotations([])).toBe('No annotation data.');
  });

  it('falls back to pmlRowsToText for unknown structure', () => {
    const rows = [{ t: 'inline', c: ['something'] }];
    const text = formatDynamicAnnotations(rows as unknown[]);
    expect(text).toBeTruthy();
  });
});

describe('type guards', () => {
  it('asItemsRow extracts from items-wrapped row', () => {
    const row = { items: [{ focus: { moment: { event: 1, instr: 0 } }, pml: { t: 'inline', c: ['x'] } }] };
    const result = asItemsRow(row);
    expect(result).not.toBeNull();
    expect(result!.items[0].focus.moment.event).toBe(1);
  });

  it('asItemsRow returns null for non-items row', () => {
    expect(asItemsRow({ t: 'inline', c: ['x'] })).toBeNull();
    expect(asItemsRow(null)).toBeNull();
    expect(asItemsRow('string')).toBeNull();
  });

  it('asPmlNode extracts from raw PmlNode or {pml:...} wrapper', () => {
    expect(asPmlNode({ t: 'inline', c: ['x'] })?.t).toBe('inline');
    expect(asPmlNode({ pml: { t: 'block', c: [] } })?.t).toBe('block');
    expect(asPmlNode(null)).toBeNull();
    expect(asPmlNode({ random: 'object' })).toBeNull();
  });
});

describe('formatStack', () => {
  it('formats stack frames with # prefix and source', () => {
    const rows = [
      { items: [{ focus: { moment: { event: 100, instr: 5 } }, pml: {
        t: 'block', a: { source: { url: 'https://hg.mozilla.org/nsDocShell.cpp', pos: { line: 4521 } } },
        c: [{ t: 'inline', c: ['nsDocShell::LoadURI(aURI)'] }]
      } }] },
      { items: [{ focus: { moment: { event: 100, instr: 3 } }, pml: {
        t: 'block', a: { source: { url: 'https://hg.mozilla.org/nsThread.cpp', pos: { line: 1234 } } },
        c: [{ t: 'inline', c: ['nsThread::ProcessNextEvent()'] }]
      } }] },
    ];
    const text = formatStack(rows as unknown[]);
    expect(text).toContain('#0');
    expect(text).toContain('#1');
    expect(text).toContain('nsDocShell.cpp:4521');
    expect(text).toContain('nsThread.cpp:1234');
    expect(text).not.toContain('[1]');
  });

  it('handles empty stack', () => {
    expect(formatStack([])).toBe('No stack frames.');
  });
});
