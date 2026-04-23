#!/usr/bin/env node
import { detectOrSpawn } from './dist/spawn.js';

function readNativeMessage(stream) {
  return new Promise((resolve, reject) => {
    const headerBuf = Buffer.alloc(4);
    let headerBytesRead = 0;

    function readHeader() {
      const chunk = stream.read(4 - headerBytesRead);
      if (!chunk) return;
      chunk.copy(headerBuf, headerBytesRead);
      headerBytesRead += chunk.length;
      if (headerBytesRead < 4) return;
      const msgLen = headerBuf.readUInt32LE(0);
      readBody(msgLen);
    }

    function readBody(msgLen) {
      const bodyBuf = Buffer.alloc(msgLen);
      let bodyBytesRead = 0;

      function onReadable() {
        const chunk = stream.read(msgLen - bodyBytesRead);
        if (!chunk) return;
        chunk.copy(bodyBuf, bodyBytesRead);
        bodyBytesRead += chunk.length;
        if (bodyBytesRead < msgLen) return;
        stream.removeListener('readable', onReadable);
        stream.removeListener('error', reject);
        stream.removeListener('end', onEnd);
        resolve(JSON.parse(bodyBuf.toString('utf8')));
      }

      function onEnd() { reject(new Error('stdin closed before message body')); }
      stream.on('readable', onReadable);
      stream.on('error', reject);
      stream.on('end', onEnd);
      onReadable();
    }

    stream.once('readable', readHeader);
    stream.once('error', reject);
    stream.once('end', () => reject(new Error('stdin closed before message header')));
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
