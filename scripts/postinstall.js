#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.dirname(__dirname);
const hostScript = path.join(pkgRoot, 'native-host.js');

function getManifestDir() {
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.mozilla', 'native-messaging-hosts');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts');
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

if (process.argv.includes('--build-only')) {
  process.exit(0);
}

try {
  const manifestDir = getManifestDir();
  fs.mkdirSync(manifestDir, { recursive: true });

  const template = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'native-host.json'), 'utf8'));
  template.path = hostScript;

  const outPath = path.join(manifestDir, 'pernosco_mcp_bridge.json');
  fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
  console.log(`pernosco-mcp: native messaging host registered at ${outPath}`);
} catch (err) {
  console.warn(`pernosco-mcp: could not register native messaging host: ${err.message}`);
}
