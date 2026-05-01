// background.js — pernosco-mcp Firefox extension background script

const PERNOSCO_URL_PATTERN = /^https:\/\/pernos\.co\/debug\/([^/]+)\//;

let daemonWs = null;
let daemonPort = null;
let pendingMessages = [];
const MAX_PENDING = 200;
let nextMsgId = 0;

// Map: tabId → { traceId, port, pendingReplies: Map<localReplyId, daemonReplyId> }
const tabs = new Map();

// ─── Native messaging / daemon connection ────────────────────────────────────

async function getDaemonPort() {
  return new Promise((resolve, reject) => {
    const nativePort = browser.runtime.connectNative('pernosco_mcp_bridge');
    nativePort.postMessage({});
    nativePort.onMessage.addListener(msg => {
      nativePort.disconnect();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.port);
    });
    nativePort.onDisconnect.addListener(() => {
      const err = browser.runtime.lastError;
      reject(new Error(err ? err.message : 'Native host disconnected'));
    });
  });
}

function connectDaemon(port) {
  daemonPort = port;
  daemonWs = new WebSocket(`ws://127.0.0.1:${port}`);

  daemonWs.onopen = () => {
    daemonWs.send(JSON.stringify({ type: 'register_extension' }));
    for (const msg of pendingMessages) daemonWs.send(JSON.stringify(msg));
    pendingMessages = [];
    for (const entry of tabs.values()) {
      daemonWs.send(JSON.stringify({ type: 'tabRegistered', traceId: entry.traceId }));
    }
  };

  daemonWs.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleDaemonMessage(msg);
  };

  daemonWs.onclose = () => {
    daemonWs = null;
    setTimeout(async () => {
      try {
        const freshPort = await getDaemonPort();
        connectDaemon(freshPort);
      } catch (err) {
        console.error('pernosco-mcp: failed to rediscover daemon port, retrying with last known port');
        connectDaemon(daemonPort);
      }
    }, 5000);
  };

  daemonWs.onerror = (err) => {
    console.error('pernosco-mcp: daemon WS error', err);
  };
}

function sendToDaemon(msg) {
  if (daemonWs && daemonWs.readyState === WebSocket.OPEN) {
    daemonWs.send(JSON.stringify(msg));
  } else if (pendingMessages.length < MAX_PENDING) {
    pendingMessages.push(msg);
  }
}

// ─── Daemon → content script routing ─────────────────────────────────────────

function handleDaemonMessage(msg) {
  switch (msg.type) {
    case 'openTab':
      browser.tabs.create({ url: msg.url });
      return;

    case 'listTabs': {
      const tabList = Array.from(tabs.values()).map(e => ({ traceId: e.traceId }));
      sendToDaemon({ type: 'tabList', replyId: msg.replyId, tabs: tabList });
      return;
    }

    case 'setFocus': {
      const entry = findTabByTraceId(msg.traceId);
      if (!entry) {
        sendToDaemon({ type: 'reply', replyId: msg.replyId, payload: null, extra: { error: `No open tab for trace ${msg.traceId}` } });
        return;
      }
      const localReplyId = `reply${nextMsgId++}`;
      const msgId = `msg${nextMsgId++}`;
      entry.pendingReplies.set(localReplyId, msg.replyId);
      entry.port.postMessage({ type: 'focus', msgId, replyId: localReplyId, payload: msg.payload });
      return;
    }

    case 'getStatus': {
      const entry = findTabByTraceId(msg.traceId);
      if (!entry) {
        sendToDaemon({ type: 'reply', replyId: msg.replyId, payload: null, extra: { error: `No open tab for trace ${msg.traceId}` } });
        return;
      }
      const localReplyId = `reply${nextMsgId++}`;
      const msgId = `msg${nextMsgId++}`;
      entry.pendingReplies.set(localReplyId, msg.replyId);
      entry.port.postMessage({ type: 'statusReport', msgId, replyId: localReplyId, payload: {} });
      return;
    }

    case 'storageDump': {
      const entry = findTabByTraceId(msg.traceId);
      if (!entry) {
        sendToDaemon({ type: 'reply', replyId: msg.replyId, payload: null, extra: { error: `No open tab for trace ${msg.traceId}` } });
        return;
      }
      const localReplyId = `reply${nextMsgId++}`;
      const msgId = `msg${nextMsgId++}`;
      entry.pendingReplies.set(localReplyId, msg.replyId);
      entry.port.postMessage({ type: 'storageDump', msgId, replyId: localReplyId, payload: {} });
      return;
    }

    case 'rangeQuery':
    case 'simpleQuery':
    case 'getSource': {
      const entry = findTabByTraceId(msg.traceId);
      if (!entry) {
        sendToDaemon({ type: 'reply', replyId: msg.replyId, payload: null, extra: { error: `No open tab for trace ${msg.traceId}` } });
        return;
      }
      const localReplyId = `reply${nextMsgId++}`;
      const msgId = `msg${nextMsgId++}`;
      entry.pendingReplies.set(localReplyId, msg.replyId);
      entry.port.postMessage({ type: msg.type, msgId, replyId: localReplyId, payload: msg.payload });
      return;
    }
  }
}

function findTabByTraceId(traceId) {
  for (const entry of tabs.values()) {
    if (entry.traceId === traceId) return entry;
  }
  return null;
}

// ─── Content script routing ───────────────────────────────────────────────────

function connectToTab(tabId, traceId, attempt = 0) {
  const port = browser.tabs.connect(tabId, { name: 'pernosco-mcp' });
  const entry = { traceId, port, pendingReplies: new Map() };
  tabs.set(tabId, entry);

  port.onMessage.addListener(msg => {
    if (msg.type !== 'reply') return;
    const daemonReplyId = entry.pendingReplies.get(msg.msgId);
    if (daemonReplyId !== undefined) {
      entry.pendingReplies.delete(msg.msgId);
      sendToDaemon({ type: 'reply', replyId: daemonReplyId, payload: msg.payload, extra: msg.extra });
    }
  });

  port.onDisconnect.addListener(() => {
    if (!tabs.has(tabId)) return;
    tabs.delete(tabId);
    entry.pendingReplies.clear();
    sendToDaemon({ type: 'tabClosed', traceId });
    if (attempt < 5) {
      setTimeout(() => {
        browser.tabs.get(tabId).then(tab => {
          const match = tab.url && PERNOSCO_URL_PATTERN.exec(tab.url);
          if (match && !tabs.has(tabId)) {
            connectToTab(tabId, match[1], attempt + 1);
          }
        }).catch(() => {});
      }, 2000);
    }
  });

  sendToDaemon({ type: 'tabRegistered', traceId });
}

// ─── Tab lifecycle ─────────────────────────────────────────────────────────────

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const match = tab.url && PERNOSCO_URL_PATTERN.exec(tab.url);
  if (!match) return;
  if (!tabs.has(tabId)) {
    connectToTab(tabId, match[1]);
  }
});

browser.tabs.onRemoved.addListener(tabId => {
  const entry = tabs.get(tabId);
  if (entry) {
    tabs.delete(tabId);
    sendToDaemon({ type: 'tabClosed', traceId: entry.traceId });
  }
});

// Connect to already-open Pernosco tabs on extension startup
browser.tabs.query({ url: 'https://pernos.co/debug/*' }).then(existingTabs => {
  for (const tab of existingTabs) {
    if (tab.id === undefined) continue;
    const match = tab.url && PERNOSCO_URL_PATTERN.exec(tab.url);
    if (match && !tabs.has(tab.id)) {
      connectToTab(tab.id, match[1]);
    }
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

getDaemonPort()
  .then(port => connectDaemon(port))
  .catch(err => console.error('pernosco-mcp: failed to connect to daemon:', err));
