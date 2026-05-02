import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

let version = '0.0.0-unknown';
try {
  const raw = execSync('git describe --tags --always --dirty', { encoding: 'utf-8' }).trim();
  version = raw.startsWith('v') ? raw.slice(1) : raw;
} catch {}

// Daemon/shim version
writeFileSync(
  new URL('../src/version.ts', import.meta.url),
  `export const VERSION = ${JSON.stringify(version)};\n`
);

// Extension manifest — AMO requires numeric-only versions (no git suffix)
const semver = version.replace(/-.*$/, '');
const manifestPath = new URL('../extension/static/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== semver && /^\d+\.\d+\.\d+$/.test(semver)) {
  manifest.version = semver;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// Extension background.js version string
const bgPath = new URL('../extension/src/background.js', import.meta.url);
let bg = readFileSync(bgPath, 'utf8');
const bgUpdated = bg.replace(
  /version: '[^']*'/,
  `version: '${version}'`
);
if (bgUpdated !== bg) {
  writeFileSync(bgPath, bgUpdated);
}
