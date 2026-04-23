import type { Focus, PmlRow, SessionStatus } from './models.js';

export interface PernoscoBackend {
  rangeQuery(
    name: string,
    params: Record<string, unknown>,
    limit?: number
  ): Promise<PmlRow[]>;

  simpleQuery(
    name: string,
    params: Record<string, unknown>
  ): Promise<PmlRow[]>;

  setFocus(focus: Focus): Promise<void>;

  getStatus(): Promise<SessionStatus>;

  close(): Promise<void>;

  notebookRead(): Promise<unknown>;
}
