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
