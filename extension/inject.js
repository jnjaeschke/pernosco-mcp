/**
 * Content script injected into Pernosco tabs. Bridges the background script
 * to Pernosco's window.client API for querying execution traces.
 */
(async function() {
'use strict';

// ─── Message handling ──────────────────────────────────────────────────────────

class MessageHandler {
  #nextId;
  #awaitingReplyPromises;
  #awaitingPortQueue;

  constructor(roleType) {
    this.roleType = roleType;
    this.#nextId = 1;
    this.#awaitingReplyPromises = new Map();
    this.#awaitingPortQueue = [];
    this.port = null;
  }

  setPort(port) {
    const queue = this.#awaitingPortQueue;
    this.#awaitingPortQueue = null;
    this.port = port;
    if (queue) {
      for (const { type, payload } of queue) {
        this.sendMessage(type, payload);
      }
    }
  }

  sendMessage(type, payload) {
    if (!this.port) {
      this.#awaitingPortQueue.push({ type, payload });
      return;
    }
    this.port.postMessage({ type, msgId: `msg${this.#nextId++}`, payload });
  }

  _onMessage(msg) {
    if (msg?.type === 'reply') {
      const entry = this.#awaitingReplyPromises.get(msg.msgId);
      if (entry) {
        entry.resolve([msg.payload, msg.extra]);
        this.#awaitingReplyPromises.delete(msg.msgId);
      }
      return;
    }

    const lookupName = `onMsg_${msg.type}`;

    let replyFunc;
    if ('replyId' in msg) {
      const replyId = msg.replyId;
      replyFunc = (payload, extra) => {
        this.port.postMessage({ type: 'reply', msgId: replyId, payload, extra });
      };
    }

    if (lookupName in this) {
      let result;
      try {
        result = this[lookupName](msg.payload, replyFunc, msg);
      } catch (ex) {
        console.error('Error processing message', msg, ex);
        if (replyFunc) replyFunc(null, { error: String(ex) });
        return;
      }
      if (result && result.then) {
        result.catch((ex) => {
          console.error('Async error processing message', msg, ex);
          if (replyFunc) replyFunc(null, { error: String(ex) });
        });
      }
    }
  }
}

// ─── Pernosco helpers ──────────────────────────────────────────────────────────

function cloneData(obj) {
  return cloneInto(obj, window);
}

/**
 * Given an active object that has internal state that does not need to be
 * exposed into the content global, create bound copies of all its methods and
 * put them on an otherwise data-free object that can be exposed into content
 * via cloneInto.
 */
function wrapActiveInto(obj) {
  const preWrap = {};
  for (let curObj = obj; curObj !== Object.prototype; curObj = Object.getPrototypeOf(curObj)) {
    for (const key of Object.getOwnPropertyNames(curObj)) {
      const val = curObj[key];
      if (typeof(val) === "function") {
        preWrap[key] = val.bind(obj);
      }
    }
  }
  return cloneInto(preWrap, window, { cloneFunctions: true });
}

const MAX_MOMENT = 1125899906842624;

/**
 * Build an "executions of" query centered around the UI's current position in
 * the trace. The query will be limited to `limit` results in events occurring
 * before and after the current position.
 */
async function buildRangeQuery(pclient, mixArgs, limit=50) {
  if (mixArgs?.params?.url && mixArgs?.params?.points) {
    const sourceText = await new window.Promise((resolve) => {
      pclient.requestSource(mixArgs.params.url, false, exportFunction(resolve, window));
    });
    let transformed = mixArgs.params.points.map(({l, c}) =>
      sourceText.wrappedJSObject.originalTextPositionToClientTextReference(cloneData({ lineNumber: l, column: c}))
    );
    mixArgs.params.points = transformed;
  }
  const queryFocus = Object.assign({}, pclient.focus);
  const focusMoment = queryFocus.moment;
  return [
    Object.assign({
      focus: queryFocus,
      limits: {
        startMoment: { event: 0, instr: 0 },
        startOffset: 0,
        endMoment: focusMoment,
        endOffset: MAX_MOMENT,
        direction: 'backward',
        lines: limit
      },
    }, mixArgs),
    Object.assign({
      focus: queryFocus,
      limits: {
        startMoment: focusMoment,
        startOffset: MAX_MOMENT,
        endMoment: { event: MAX_MOMENT, instr: MAX_MOMENT },
        endOffset: MAX_MOMENT,
        direction: 'forward',
        lines: limit
      },
    }, mixArgs),
    focusMoment,
  ];
}

async function buildSimpleQuery(pclient, mixArgs) {
  const queryFocus = Object.assign({}, pclient.focus);
  if (mixArgs?.payload?.context) {
    const sourceText = await new window.Promise((resolve) => {
      pclient.requestSource(mixArgs.payload.context[0], false, exportFunction(resolve, window));
    });
    const pos = mixArgs.payload.context[1];
    mixArgs.payload.context[1] = sourceText.wrappedJSObject.originalTextPositionToClientTextReference(cloneData({ lineNumber: pos.l, column: pos.c }));
  }
  return Object.assign({ focus: queryFocus }, mixArgs);
}

// ─── Query result collection ───────────────────────────────────────────────────

class BatchHandler {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this.results = [];
  }

  onData(id, data) {
    try {
      this.results.push(JSON.parse(JSON.stringify(data)));
    } catch (e) {
      console.warn('pernosco-mcp: failed to deep-clone query result', e);
      this.results.push(data);
    }
  }

  onClose(id, hasNoMore, noResults) {
    this._resolve(this.results);
  }

  onDisconnected(id) {
    this._reject('disconnected');
  }
}

// ─── View registration ─────────────────────────────────────────────────────────

/**
 * Singleton view registered into the Client's list of views so that the bridge
 * can receive "status report" updates that reflect the current focus and source
 * line.
 */
class BridgeHelperView {
  constructor({ pclient, bridge }) {
    this.queryName = 'pernosco-bridge-helper';
    this.pclient = pclient;
    this.bridge = bridge;
  }

  updateStorage(updates) {}

  onOtherViewWillSetFocus(focusSettingView) {}

  onFocusChange(oldFocus, oldSource, settingView, options) {
    try {
      this.bridge.sendStatusReport(options);
    } catch (ex) {
      console.error('pernosco-mcp: sendStatusReport failed in onFocusChange', ex);
    }
  }

  updateFocusAnnotation(annotation) {
    try {
      this.bridge.sendStatusReport({ annotation });
    } catch (ex) {
      console.error('pernosco-mcp: sendStatusReport failed in updateFocusAnnotation', ex);
    }
  }

  onUserHighlightChange(before, after) {}

  onDisconnect() {}
}

// ─── Content script server ─────────────────────────────────────────────────────

class ContentScriptServer extends MessageHandler {
  constructor() {
    super('server');
    this.pclient = window.wrappedJSObject.client;
    this._registerView();

    browser.runtime.onConnect.addListener((port) => {
      this.setPort(port);
      port.onMessage.addListener(this._onMessage.bind(this));
      this.sendMessage('helloThisIsServer', {
        status: this.generateStatusReportPayload(),
      });
    });
  }

  _registerView() {
    this.wrappedBridgeHelperView = wrapActiveInto(new BridgeHelperView({
      pclient: this.pclient,
      bridge: this,
    }));
    this.pclient.addView(this.wrappedBridgeHelperView);
  }

  _refreshClient() {
    const fresh = window.wrappedJSObject?.client;
    if (!fresh) throw new Error('Pernosco client not available');
    this.pclient = fresh;
    this._registerView();
  }

  _isDeadObjectError(e) {
    const s = String(e);
    return s.includes('dead object') || s.includes("can't access");
  }

  _ensureClient() {
    try {
      void this.pclient.focus;
    } catch (e) {
      if (this._isDeadObjectError(e)) {
        console.warn('pernosco-mcp: pclient was dead, re-acquiring');
        this._refreshClient();
      } else {
        throw e;
      }
    }
  }

  _withRetry(fn) {
    this._ensureClient();
    try {
      return fn();
    } catch (e) {
      if (this._isDeadObjectError(e)) {
        console.warn('pernosco-mcp: dead object in handler, refreshing client and retrying');
        this._refreshClient();
        return fn();
      }
      throw e;
    }
  }

  async _withRetryAsync(fn) {
    this._ensureClient();
    try {
      return await fn();
    } catch (e) {
      if (this._isDeadObjectError(e)) {
        console.warn('pernosco-mcp: dead object in async handler, refreshing client and retrying');
        this._refreshClient();
        return await fn();
      }
      throw e;
    }
  }

  generateStatusReportPayload(options) {
    const pclient = this.pclient;
    let annotation = options ? options.annotation : pclient.lastAnnotation;
    return { focus: pclient.focus, source: pclient.source, annotation };
  }

  _openQuery(name, req, handler) {
    return this.pclient.openQuery(name, req, handler, cloneData({ api: 1 }));
  }

  sendStatusReport(options) {
    this.sendMessage('statusReport', this.generateStatusReportPayload(options));
  }

  onMsg_focus({ focus, source }, reply) {
    this._withRetry(() => {
      this.pclient.willSetFocus(this.wrappedBridgeHelperView);
      this.pclient.setFocus(cloneData(focus), source ? cloneData(source) : cloneData(null), this.wrappedBridgeHelperView, cloneData({}));
    });
    if (reply) reply({ ok: true });
  }

  onMsg_statusReport({}, reply) {
    reply(this._withRetry(() => this.generateStatusReportPayload()));
  }

  onMsg_storageDump({}, reply) {
    reply(this._withRetry(() => this.pclient.storageData));
  }

  async onMsg_getSource({ url, startLine, endLine }, reply) {
    await this._withRetryAsync(async () => {
      const sourceText = await new window.Promise((resolve) => {
        this.pclient.requestSource(url, false, exportFunction(resolve, window));
      });
      const text = sourceText.wrappedJSObject.originalText;
      const allLines = text.split('\n');
      const start = (startLine || 1) - 1;
      const end = endLine || allLines.length;
      reply({ url, lines: allLines.slice(start, end) });
    });
  }

  async onMsg_simpleQuery({ name, mixArgs }, reply) {
    await this._withRetryAsync(async () => {
      let queryId;
      try {
        const req = await buildSimpleQuery(this.pclient, mixArgs);
        const handler = new BatchHandler();
        queryId = this._openQuery(name, cloneData(req), wrapActiveInto(handler));
        const results = await handler.promise;
        queryId = null;
        reply(results);
      } finally {
        if (queryId) this.pclient.cancelQuery(queryId);
      }
    });
  }

  async onMsg_rangeQuery({ name, limit, mixArgs }, reply) {
    await this._withRetryAsync(async () => {
      let beforeQueryId, afterQueryId;
      try {
        const useLimit = limit || 50;
        const [beforeReq, afterReq, focusMoment] = await buildRangeQuery(this.pclient, mixArgs, useLimit);
        const beforeHandler = new BatchHandler();
        beforeQueryId = this._openQuery(name, cloneData(beforeReq), wrapActiveInto(beforeHandler));
        const afterHandler = new BatchHandler();
        afterQueryId = this._openQuery(name, cloneData(afterReq), wrapActiveInto(afterHandler));

        const beforeResults = await beforeHandler.promise;
        beforeQueryId = null;
        const afterResults = await afterHandler.promise;
        afterQueryId = null;

        beforeResults.reverse();
        reply([...beforeResults, ...afterResults], {
          focusMoment,
          beforeCount: beforeResults.length,
          afterCount: afterResults.length,
          limit: useLimit,
        });
      } finally {
        if (beforeQueryId) this.pclient.cancelQuery(beforeQueryId);
        if (afterQueryId) this.pclient.cancelQuery(afterQueryId);
      }
    });
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  if (globalThis.server) {
    browser.runtime.sendMessage({ type: 'contentScriptReady', url: window.location.href }).catch(() => {});
    return;
  }

  if (globalThis._pernoscoMcpInitializing) return;
  globalThis._pernoscoMcpInitializing = true;

  const maxWait = 15000;
  const start = Date.now();
  while (!window.wrappedJSObject?.client) {
    if (Date.now() - start > maxWait) {
      console.error('pernosco-mcp: window.client not available after 15s');
      globalThis._pernoscoMcpInitializing = false;
      return;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  try {
    globalThis.server = new ContentScriptServer();
    browser.runtime.sendMessage({ type: 'contentScriptReady', url: window.location.href }).catch(() => {});
  } catch (ex) {
    console.error('pernosco-mcp:', ex);
  }
  globalThis._pernoscoMcpInitializing = false;
}

await init();
})();
