import { describe, it, expect } from 'vitest';
import { pmlToText, pmlRowsToText, formatStack, formatDynamicAnnotations } from '../src/pml.js';
import type { PmlNode } from '../src/models.js';

describe('pml complex structures', () => {
  it('handles nested block with ident and number children', () => {
    const node: PmlNode = {
      t: 'block',
      c: [
        { t: 'ident', c: ['nsDocShell'] },
        '::',
        { t: 'ident', c: ['LoadURI'] },
        '(',
        { t: 'ident', c: ['aURI'] },
        ' = ',
        { t: 'number', c: ['0x7fff1234'] },
        ')',
      ],
    };
    const text = pmlToText(node);
    // At depth=0, block joins children with newlines
    expect(text).toContain('nsDocShell');
    expect(text).toContain('LoadURI');
    expect(text).toContain('aURI');
    expect(text).toContain('0x7fff1234');
  });

  it('handles task node with source annotation', () => {
    const node: PmlNode = {
      t: 'task',
      a: { source: { url: 'https://hg.mozilla.org/mozilla-central/raw-file/tip/docshell/base/nsDocShell.cpp', pos: { line: 4521 } } },
      c: ['Thread 1 (tid=12345)'],
    };
    const text = pmlToText(node);
    expect(text).toContain('Thread 1 (tid=12345)');
    expect(text).toContain('nsDocShell.cpp');
  });

  it('handles process node', () => {
    const node: PmlNode = {
      t: 'process',
      a: { source: { url: 'https://hg.mozilla.org/main.cpp' } },
      c: ['firefox (pid=42)'],
    };
    const text = pmlToText(node);
    expect(text).toContain('firefox (pid=42)');
    expect(text).toContain('main.cpp');
  });

  it('handles str node', () => {
    const node: PmlNode = {
      t: 'str',
      c: ['"hello world"'],
    };
    expect(pmlToText(node)).toBe('"hello world"');
  });

  it('handles unknown node types gracefully', () => {
    const node: PmlNode = {
      t: 'some_future_type',
      c: ['content inside'],
    };
    expect(pmlToText(node)).toBe('content inside');
  });

  it('handles deeply nested blocks', () => {
    const node: PmlNode = {
      t: 'block',
      c: [
        {
          t: 'block',
          c: [
            { t: 'ident', c: ['outer'] },
            ' { ',
            {
              t: 'block',
              c: [
                { t: 'ident', c: ['inner'] },
                ' = ',
                { t: 'number', c: ['42'] },
              ],
            },
            ' }',
          ],
        },
      ],
    };
    const text = pmlToText(node);
    expect(text).toContain('outer');
    expect(text).toContain('inner');
    expect(text).toContain('42');
  });

  it('handles null and undefined in pmlToText', () => {
    expect(pmlToText(null)).toBe('');
    expect(pmlToText(undefined)).toBe('');
  });

  it('pmlRowsToText with mixed row types', () => {
    const rows = [
      { items: [{ focus: { moment: { event: 100, instr: 5 } }, pml: { t: 'inline', c: ['first item'] } }] },
      { t: 'block', c: ['raw pml row'] },
      { someUnknown: 'data' },
    ];
    const text = pmlRowsToText(rows);
    expect(text).toContain('[1] first item');
    expect(text).toContain('[2] raw pml row');
    expect(text).toContain('[3]');
  });
});

describe('formatDynamicAnnotations edge cases', () => {
  it('handles PML attribute format (a.lineNumber)', () => {
    const rows = [
      { a: { lineNumber: 10, count: 5, strength: 'strong' } },
      { a: { lineNumber: 11, strength: 'weak' } },
      { a: { lineNumber: 12, count: 0, strength: 'none' } },
    ];
    const text = formatDynamicAnnotations(rows);
    expect(text).toContain('line 10: 5×');
    expect(text).toContain('line 11: 1× (weak)');
    expect(text).toContain('line 12: not executed');
  });

  it('sorts annotations by line number', () => {
    const rows = [
      { a: { lineNumber: 30, count: 1, strength: 'strong' } },
      { a: { lineNumber: 10, count: 1, strength: 'strong' } },
      { a: { lineNumber: 20, count: 1, strength: 'strong' } },
    ];
    const text = formatDynamicAnnotations(rows);
    const lines = text.split('\n');
    expect(lines[0]).toContain('line 10');
    expect(lines[1]).toContain('line 20');
    expect(lines[2]).toContain('line 30');
  });
});
