import { runShim } from './shim.js';

async function main(): Promise<void> {
  await runShim();
}

main().catch(err => {
  console.error('pernosco-mcp:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
