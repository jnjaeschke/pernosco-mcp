import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

let version = '0.0.0-unknown';
try {
  const raw = execSync('git describe --tags --always --dirty', { encoding: 'utf-8' }).trim();
  version = raw.startsWith('v') ? raw.slice(1) : raw;
} catch {}

writeFileSync(
  new URL('../src/version.ts', import.meta.url),
  `export const VERSION = ${JSON.stringify(version)};\n`
);
