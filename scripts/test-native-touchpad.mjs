// Reads a real attached DualSense through the same local endpoint as SearchModal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createServer } from 'vite';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/dualsenseTouchpad.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports, EventTarget, Event, performance });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
let reader;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const status = await fetch(new URL('__dualsense/status', base));
  assert.equal((await status.json()).available, true);
  const response = await fetch(new URL('__dualsense/events', base), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  reader = response.body.getReader();
  let pending = '';
  let verified = false;
  let firstReportAt = 0;
  let reports = 0;
  while (!verified) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += new TextDecoder().decode(value);
    let end;
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const message = pending.slice(0, end); pending = pending.slice(end + 2);
      if (!message.startsWith('data: ')) continue;
      const packet = JSON.parse(message.slice(6));
      const view = new DataView(Uint8Array.from(packet.bytes).buffer);
      const sample = exports.decodeDualSenseTouchpad(packet.reportId, view);
      if (!sample) continue;
      assert.ok(exports.decodeDualSenseGamepad(packet.reportId, view));
      assert.ok(sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1);
      firstReportAt ||= Date.now();
      reports++;
      if (Date.now() - firstReportAt >= 3500) {
        console.log(`Real DualSense stream passed: report 0x${packet.reportId.toString(16)}, ${view.byteLength} payload bytes; ${reports} valid reports across 3.5 seconds.`);
        verified = true;
        break;
      }
    }
  }
  assert.ok(verified, 'No full DualSense touch report was received.');
  const rumble = await fetch(new URL('__dualsense/rumble?duration=120&weak=0.55&strong=0.3', base), { method: 'POST' });
  assert.equal(rumble.status, 204, 'native Bluetooth rumble report must be accepted by the attached device');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const stopped = await fetch(new URL('__dualsense/rumble?duration=1&weak=0&strong=0', base), { method: 'POST' });
  assert.equal(stopped.status, 204, 'motor stop report must be accepted');
  const invalid = await fetch(new URL('__dualsense/rumble?duration=5000&weak=1&strong=1', base), { method: 'POST' });
  assert.equal(invalid.status, 400);
  const next = await reader.read();
  assert.equal(next.done, false, 'rumble output must retain the controller input stream');
  console.log('Native rumble and motor stop accepted; input stream remains open.');
} finally {
  await reader?.cancel().catch(() => {});
  await server.close();
}
