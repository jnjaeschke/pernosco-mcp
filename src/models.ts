export interface Moment {
  event: number;
  instr: number;
}

export interface Focus {
  moment: Moment;
  frame?: Record<string, unknown>;
  tuid?: Record<string, unknown>;
  data?: string;
  node?: string;
}

export interface PmlNode {
  t: string;
  a?: {
    focus?: Focus;
    source?: { url: string; pos?: Record<string, unknown> };
    itemTypeName?: string;
    extent?: { s?: Focus; e?: Focus };
    data?: Record<string, unknown>;
    [key: string]: unknown;
  };
  c?: Array<PmlNode | string>;
}

// A single result row from a Pernosco query — opaque object from the extension
export type PmlRow = unknown;

export interface SessionStatus {
  focus: Focus;
  source?: { url: string; pos?: Record<string, unknown> };
  annotation?: unknown;
}

export interface ServerInfo {
  port: number;
  pid: number;
}
