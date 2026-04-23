import { detectOrSpawn } from './spawn.js';
import { runShim } from './shim.js';

async function main(): Promise<void> {
  const port = await detectOrSpawn();
  await runShim(port);
}

main().catch(err => {
  console.error('pernosco-mcp:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
