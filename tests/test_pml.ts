import { describe, it, expect } from 'vitest';
import { pmlToText, pmlRowsToText } from '../src/pml.js';
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
