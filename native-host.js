#!/usr/bin/env node

let detectOrSpawn;
try {
  ({ detectOrSpawn } = await import('./dist/spawn.js'));
} catch {
  const json = JSON.stringify({ error: 'pernosco-mcp not built. Run: npm run build' });
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
  process.exit(1);
}

function readNativeMessage(stream) {
  return new Promise((resolve, reject) => {
    const headerBuf = Buffer.alloc(4);
    let headerBytesRead = 0;

    function cleanup() {
      stream.removeListener('readable', readHeader);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    }
    function onError(err) { cleanup(); reject(err); }
    function onEnd() { cleanup(); reject(new Error('stdin closed before complete message')); }

    function readHeader() {
      const chunk = stream.read(4 - headerBytesRead);
      if (!chunk) return;
      chunk.copy(headerBuf, headerBytesRead);
      headerBytesRead += chunk.length;
      if (headerBytesRead < 4) return;
      cleanup();
      readBody(headerBuf.readUInt32LE(0));
    }

    function readBody(msgLen) {
      const bodyBuf = Buffer.alloc(msgLen);
      let bodyBytesRead = 0;

      function onBodyReadable() {
        const chunk = stream.read(msgLen - bodyBytesRead);
        if (!chunk) return;
        chunk.copy(bodyBuf, bodyBytesRead);
        bodyBytesRead += chunk.length;
        if (bodyBytesRead < msgLen) return;
        stream.removeListener('readable', onBodyReadable);
        stream.removeListener('error', onBodyError);
        stream.removeListener('end', onBodyEnd);
        resolve(JSON.parse(bodyBuf.toString('utf8')));
      }

      function onBodyError(err) {
        stream.removeListener('readable', onBodyReadable);
        stream.removeListener('end', onBodyEnd);
        reject(err);
      }
      function onBodyEnd() {
        stream.removeListener('readable', onBodyReadable);
        stream.removeListener('error', onBodyError);
        reject(new Error('stdin closed before message body'));
      }

      stream.on('readable', onBodyReadable);
      stream.on('error', onBodyError);
      stream.on('end', onBodyEnd);
      onBodyReadable();
    }

    stream.on('readable', readHeader);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

function writeNativeMessage(stream, obj) {
  const json = JSON.stringify(obj);
  const jsonBuf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(jsonBuf.length, 0);
  stream.write(header);
  stream.write(jsonBuf);
}

async function main() {
  try {
    await readNativeMessage(process.stdin);
    const port = await detectOrSpawn();
    writeNativeMessage(process.stdout, { port });
  } catch (err) {
    writeNativeMessage(process.stdout, { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main();
