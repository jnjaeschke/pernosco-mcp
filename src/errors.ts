export class PernoscoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConnectionError extends PernoscoError {}

export class QueryError extends PernoscoError {}

export class SessionNotConnected extends PernoscoError {
  constructor() {
    super('No session connected. Call session_connect first.');
  }
}

export class TraceNotFound extends PernoscoError {
  constructor(traceId: string) {
    super(`Trace not found: ${traceId}`);
  }
}

export class TabNotFound extends PernoscoError {
  constructor(traceId: string) {
    super(`No open Pernosco tab for trace ${traceId}. Open the URL in Firefox first.`);
  }
}
