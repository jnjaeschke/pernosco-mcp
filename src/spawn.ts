import { lock } from 'proper-lockfile';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';
import { fileURLToPath } from 'url';
import type { ServerInfo } from './models.js';

export const CONFIG_DIR = path.join(os.homedir(), '.pernosco-mcp');
export const SERVER_JSON = path.join(CONFIG_DIR, 'server.json');
const LOCK_FILE = path.join(CONFIG_DIR, 'spawn.lock');
const HEALTH_TIMEOUT_MS = 2000;
const MAX_WAIT_MS = 10000;
const POLL_INTERVAL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function checkHealth(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(
      `http://localhost:${port}/health`,
      { timeout: HEALTH_TIMEOUT_MS },
      res => { resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function readServerJson(): Promise<ServerInfo | null> {
  try {
    const raw = await fs.readFile(SERVER_JSON, 'utf8');
    return JSON.parse(raw) as ServerInfo;
  } catch {
    return null;
  }
}

async function spawnDaemon(): Promise<void> {
  const daemonScript = fileURLToPath(new URL('./daemon.js', import.meta.url));
  const logPath = path.join(CONFIG_DIR, 'daemon.log');
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();
}

async function waitForDaemon(): Promise<number> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const info = await readServerJson();
    if (info && await checkHealth(info.port)) {
      return info.port;
    }
  }
  throw new Error(`Daemon failed to start within ${MAX_WAIT_MS}ms`);
}

export async function detectOrSpawn(): Promise<number> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  // Ensure lock file exists for proper-lockfile
  await fs.writeFile(LOCK_FILE, '', { flag: 'a' });

  const release = await lock(LOCK_FILE, { stale: 30000, retries: { retries: 20, minTimeout: 50 } });
  try {
    const info = await readServerJson();
    if (info && await checkHealth(info.port)) {
      return info.port;
    }
    await spawnDaemon();
    return await waitForDaemon();
  } finally {
    await release();
  }
}
