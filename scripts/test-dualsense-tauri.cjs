const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const service = {};
const windowMock = new EventTarget();
const calls = [];
const timers = new Map();
let nextId = 0;
let queued;
let frontendTime = 1000;
const packet = (timestampMs, active, ps = false) => {
  const bytes = Array(63).fill(0);
  bytes[0] = bytes[1] = bytes[2] = bytes[3] = 128;
  bytes[7] = 8;
  bytes[9] = ps ? 1 : 0;
  bytes[32] = active ? 1 : 129;
  bytes[33] = 0xc0; bytes[34] = 0xc3; bytes[35] = 0x21; // x=960, y=540
  return { reportId: 1, bytes, timestampMs };
};
queued = { connected: true, nowMs: 1000, reports: [packet(900, true, true), packet(960, false)] };
const invoke = async (name, args) => {
  calls.push([name, args]);
  if (name === 'dualsense_poll') return queued;
  if (name === 'dualsense_rumble') return true;
  throw new Error('Unexpected command: ' + name);
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/dualsenseTouchpad.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: service, require: () => ({ getTauriInvoker: () => invoke }), window: windowMock,
  navigator: {}, performance: { now: () => frontendTime }, EventTarget, Event, console,
  setTimeout: (fn) => { const id = ++nextId; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id),
});
async function tick(batch) {
  queued = batch;
  frontendTime = batch.nowMs;
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  await callback();
}
(async () => {
  const samples = [], pads = [];
  const stop = await service.connectDualSenseTouchpad((sample) => samples.push(sample), () => {}, false, (pad) => pads.push(pad));
  assert.equal(samples.filter((sample) => sample.activate).length, 1, 'queued taps retain physical duration even if delivered together');
  assert.equal(samples[0].x, 0.5); assert.equal(samples[0].y, 0.5);
  assert.equal(pads[0].id, 'Sony DualSense (Native HID)');
  assert.equal(pads[0].buttons[16].pressed, false, 'PS is owned by Rust and cannot trigger again through the browser');
  assert.equal(service.pulseNativeDualSense(40, 0.3, 0.2), true);
  assert.equal(calls.at(-1)[0], 'dualsense_rumble');
  windowMock.dispatchEvent(new CustomEvent('steam-overlay-state', { detail: true }));
  const count = samples.length;
  await tick({ connected: true, nowMs: 1200, reports: [packet(1100, true), packet(1170, false)] });
  assert.equal(samples.length, count, 'Steam overlay touch gestures do not reach the background keyboard');
  windowMock.dispatchEvent(new CustomEvent('steam-overlay-state', { detail: false }));
  await tick({ connected: false, nowMs: 1300, reports: [] });
  assert.equal(pads.at(-1), null, 'disconnect clears stale held buttons');
  assert.equal(service.pulseNativeDualSense(40, 0.3, 0.2), false);
  await tick({ connected: true, nowMs: 1500, reports: [packet(1400, true), packet(1460, false)] });
  assert.equal(samples.filter((sample) => sample.activate).length, 2, 'reconnected controller resumes gestures');
  stop();
  assert.equal(timers.size, 0, 'unmount stops native polling');
  console.log('Tauri DualSense tests passed: native-only transport, tap timing, PS ownership, rumble, overlay isolation, reconnection and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
