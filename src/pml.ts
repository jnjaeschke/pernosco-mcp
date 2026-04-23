import type { PmlNode, PmlRow } from './models.js';

export function pmlToText(node: PmlNode | string | null | undefined, depth = 0): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;

  const children = node.c ?? [];

  switch (node.t) {
    case 'ident':
    case 'number':
    case 'str':
      return children.map(c => pmlToText(c as PmlNode | string)).join('');

    case 'task':
    case 'process': {
      const inner = children.map(c => pmlToText(c as PmlNode | string)).join('');
      const source = node.a?.source;
      if (source && typeof source === 'object' && 'url' in source) {
        const url = source.url as string;
        const file = url.split('/').pop() ?? url;
        return `${inner} [${file}]`;
      }
      return inner;
    }

    case 'block': {
      const parts = children.map(c => pmlToText(c as PmlNode | string, depth + 1)).filter(Boolean);
      return depth === 0 ? parts.join('\n') : parts.join(' ');
    }

    default: {
      return children.map(c => pmlToText(c as PmlNode | string, depth)).join('');
    }
  }
}

function extractPml(row: unknown): PmlNode | null {
  if (row == null || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (r.pml && typeof r.pml === 'object') return r.pml as PmlNode;
  if (r.t) return row as PmlNode;
  return null;
}

export function pmlRowsToText(rows: PmlRow[]): string {
  if (rows.length === 0) return 'No results.';
  return rows
    .map((row, i) => {
      const pml = extractPml(row);
      const text = pml ? pmlToText(pml) : JSON.stringify(row);
      return `[${i + 1}] ${text.trim()}`;
    })
    .join('\n\n');
}

function extractMoment(row: unknown): { event: number; instr: number } | null {
  const r = row as Record<string, unknown>;
  const items = r?.items as Array<Record<string, unknown>> | undefined;
  const focus = items?.[0]?.focus as Record<string, unknown> | undefined;
  const moment = focus?.moment as { event: number; instr: number } | undefined;
  return moment ?? null;
}

function extractPmlFromStdoutRow(row: unknown): PmlNode | null {
  const pml = extractPml(row);
  if (pml) return pml;
  const r = row as Record<string, unknown>;
  const items = r?.items as Array<Record<string, unknown>> | undefined;
  if (items?.[0]) return extractPml(items[0]);
  return null;
}

export function formatStdoutStderr(rows: unknown[]): string {
  if (rows.length === 0) return 'No output found.';
  return rows
    .map((row, i) => {
      const moment = extractMoment(row);
      const pml = extractPmlFromStdoutRow(row);
      const text = pml ? pmlToText(pml).trim() : String(row);
      const prefix = moment ? `[${i + 1}] event=${moment.event}` : `[${i + 1}]`;
      return `${prefix}  ${text}`;
    })
    .join('\n');
}

function extractAnnotationLine(row: unknown): { lineNumber: number; count: number; strength: string } | null {
  const r = row as Record<string, unknown>;
  if (typeof r.lineNumber === 'number') {
    return {
      lineNumber: r.lineNumber as number,
      count: typeof r.count === 'number' ? r.count : 0,
      strength: typeof r.strength === 'string' ? r.strength : 'unknown',
    };
  }
  const a = r.a as Record<string, unknown> | undefined;
  if (a && typeof a.lineNumber === 'number') {
    return {
      lineNumber: a.lineNumber as number,
      count: typeof a.count === 'number' ? a.count : 1,
      strength: typeof a.strength === 'string' ? a.strength : 'strong',
    };
  }
  return null;
}

export function formatDynamicAnnotations(rows: unknown[]): string {
  if (rows.length === 0) return 'No annotation data.';

  const annotations = rows.map(r => extractAnnotationLine(r)).filter(Boolean) as Array<{ lineNumber: number; count: number; strength: string }>;

  if (annotations.length === 0) {
    return pmlRowsToText(rows as PmlRow[]);
  }

  annotations.sort((a, b) => a.lineNumber - b.lineNumber);

  return annotations
    .map((ann, i) => {
      if (ann.count === 0 || ann.strength === 'none') {
        return `[${i + 1}] line ${ann.lineNumber}: not executed`;
      }
      const countStr = ann.count > 1 ? `${ann.count}×` : '1×';
      const weakStr = ann.strength === 'weak' ? ' (weak)' : '';
      return `[${i + 1}] line ${ann.lineNumber}: ${countStr}${weakStr}`;
    })
    .join('\n');
}
