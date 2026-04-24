#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.dirname(__dirname);
const hostScript = path.join(pkgRoot, 'native-host.js');

if (process.argv.includes('--build-only')) {
  process.exit(0);
}

function registerUnix() {
  let manifestDir;
  if (process.platform === 'linux') {
    manifestDir = path.join(os.homedir(), '.mozilla', 'native-messaging-hosts');
  } else if (process.platform === 'darwin') {
    manifestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts');
  } else {
    return false;
  }

  fs.mkdirSync(manifestDir, { recursive: true });
  const template = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'native-host.json'), 'utf8'));
  template.path = hostScript;
  const outPath = path.join(manifestDir, 'pernosco_mcp_bridge.json');
  fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
  console.log(`pernosco-mcp: native messaging host registered at ${outPath}`);
  return true;
}

function registerWindows() {
  const manifestPath = path.join(pkgRoot, 'native-host.json');
  const template = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  template.path = hostScript;

  const resolvedManifest = path.join(pkgRoot, 'native-host-resolved.json');
  fs.writeFileSync(resolvedManifest, JSON.stringify(template, null, 2));

  const regKey = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\pernosco_mcp_bridge';
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${resolvedManifest}" /f`, { stdio: 'pipe' });
    console.log(`pernosco-mcp: native messaging host registered in registry (${regKey})`);
    return true;
  } catch (err) {
    console.warn(`pernosco-mcp: failed to write registry key: ${err.message}`);
    return false;
  }
}

try {
  if (process.platform === 'win32') {
    registerWindows();
  } else {
    if (!registerUnix()) {
      console.warn('pernosco-mcp: native messaging host registration not supported on this platform');
    }
  }
} catch (err) {
  console.warn(`pernosco-mcp: could not register native messaging host: ${err.message}`);
}
