const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, requireMock = () => ({}), globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: requireMock, console, EventTarget, Event, performance, ...globals });
  return exports;
}
const navigation = load('src/utils/keyboardNavigation.ts');
const gel = load('src/utils/keyboardGel.ts', () => navigation);
assert.equal(gel.smoothGelUnion(-1, -1, 4), -2, 'merge rate controls the smooth attraction between both surfaces');
const gelFrom = { left: 0, top: 0, width: 60, height: 60 };
const gelTo = { left: 80, top: 0, width: 60, height: 60 };
const motionRun = (interval) => {
  const pad = new navigation.RelativeKeyboardTouchpad();
  const steps = [];
  pad.update({ active: true, contactId: 1, x: 0, y: 0 }, 0);
  for (let i = 1; i <= 8; i++) steps.push(...pad.update({ active: true, contactId: 1, x: i * 85 / 1920, y: 0 }, i * interval));
  return { pad, steps, time: 8 * interval };
};
const fastMotion = motionRun(20), slowMotion = motionRun(120);
assert.deepEqual(fastMotion.steps, slowMotion.steps, 'speed changes the appearance without changing navigation');
assert.ok(fastMotion.pad.getMotionStyle(fastMotion.time).deformation < 0.09, 'fast swipes keep the bubble nearly whole');
assert.equal(slowMotion.pad.getMotionStyle(slowMotion.time).deformation, 1, 'slow dragging retains the full gel merge');
assert.equal(fastMotion.pad.getMotionStyle(fastMotion.time + 500).deformation, 1, 'the gel recovers while the finger is stationary without new reports');
fastMotion.pad.reset();
assert.equal(fastMotion.pad.getMotionStyle(1000).speed, 0, 'release clears motion history');
const intactGel = gel.mergedKeyboardGel(gelFrom, gelTo, 0.5, 0.85, 0);
assert.equal(intactGel.width, gelFrom.width);
assert.equal(intactGel.left, 40);
assert.ok(gel.mergedKeyboardGel(gelFrom, gelTo, 0.5, 0.85, 0.08).width < gel.mergedKeyboardGel(gelFrom, gelTo, 0.5).width, 'fast motion suppresses stretching');
const weakMerge = gel.mergedKeyboardGel(gelFrom, gelTo, 0.5, 0.3);
const strongMerge = gel.mergedKeyboardGel(gelFrom, gelTo, 0.5, 1.2);
const initialMerge = gel.mergedKeyboardGel(gelFrom, gelTo, 0.05);
assert.ok(initialMerge.left + initialMerge.width < gelFrom.left + gelFrom.width + 10, 'the new lobe starts inside the source instead of pulling a distant tip');
assert.notEqual(weakMerge.path, strongMerge.path, 'merge rate changes the actual contour');
assert.ok(strongMerge.height > weakMerge.height, 'higher merge rate creates a fuller fused gel surface');
for (const destination of [gelTo, { ...gelTo, left: 0, top: 80 }, { ...gelTo, top: 80 }]) {
  for (const progress of [0, 0.15, 0.5, 0.85, 1]) {
    for (const deformation of [0.08, 0.5, 1]) {
      const shape = gel.mergedKeyboardGel(gelFrom, destination, progress, 0.85, deformation);
      assert.ok([shape.left, shape.top, shape.width, shape.height].every(Number.isFinite));
      assert.ok(shape.width > 0 && shape.height > 0);
      assert.equal((shape.path.match(/M /g) || []).length, 1, 'horizontal, vertical and diagonal merge produce one continuous outline');
    }
  }
}
for (const phase of [0, 1, 2, 3]) {
  const coordinates = navigation.liquidKeyboardPath(85, 60, 0.5, true, phase).match(/-?\d+(?:\.\d+)?/g).map(Number);
  const points = [];
  for (let i = 0; i < coordinates.length; i += 2) points.push([coordinates[i], coordinates[i + 1]]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    assert.ok(cross >= -0.01, 'gel outline stays convex without a glue-like waist');
  }
}
assert.equal(navigation.keyboardGelSpring(0), 0);
assert.ok(navigation.keyboardGelSpring(0.17) > 1, 'gel spring has a small elastic overshoot');
assert.ok(Math.abs(navigation.keyboardGelSpring(0.26) - 1) < 0.02);
assert.notEqual(navigation.liquidKeyboardPath(80, 50, 0.5, true, 0), navigation.liquidKeyboardPath(80, 50, 0.5, true, 2), 'each gesture can have a different liquid shape');
for (const endpoint of [0, 1]) {
  assert.equal(navigation.liquidKeyboardPath(80, 50, endpoint, true, 0), navigation.liquidKeyboardPath(80, 50, endpoint, true, 2), 'liquid variation settles into the same key outline');
}
assert.ok(navigation.keyboardDetachmentProgress(0.4) < 0.05, 'selector resists early dragging');
assert.ok(navigation.keyboardDetachmentProgress(0.55) < 0.035, 'selector remains anchored longer before release');
assert.ok(navigation.keyboardDetachmentProgress(0.75) > 0.65, 'selector releases quickly past the detent');
assert.ok(navigation.keyboardDetachmentProgress(0.95) > 0.99, 'selector softens into the destination');
assert.equal(navigation.keyboardDetachmentProgress(0), 0);
assert.equal(navigation.keyboardDetachmentProgress(1), 1);
const relative = new navigation.RelativeKeyboardTouchpad();
const diagonal = new navigation.RelativeKeyboardTouchpad();
let diagonalX = 0.3, diagonalY = 0.3;
diagonal.update({ active: true, contactId: 1, x: diagonalX, y: diagonalY });
const diagonalSteps = [];
for (let i = 0; i < 30; i++) {
  diagonalX += 20 / 1920; diagonalY += (i % 2 ? 19 : 21) / 1080;
  const steps = diagonal.update({ active: true, contactId: 1, x: diagonalX, y: diagonalY });
  if (steps.length) assert.deepEqual(Array.from(steps), ['down', 'right'], 'diagonal movement commits both axes together');
  diagonalSteps.push(...steps);
}
assert.ok(diagonalSteps.length > 0);
assert.equal(new Set(diagonalSteps).size, 2, 'diagonal gestures support both rows and columns');
for (let i = 0; i < 8; i++) {
  diagonalX += 20 / 1920;
  diagonal.update({ active: true, contactId: 1, x: diagonalX, y: diagonalY });
}
assert.equal(diagonal.getDragProgress().y, 0, 'a deliberate horizontal turn releases a vertical lock');
for (const points of [
  [[20, 0], [40, -15], [70, -40], [115, -85], [180, -150]],
  [[0, -20], [20, -35], [50, -55], [90, -85], [120, -105]],
]) {
  const gesture = new navigation.RelativeKeyboardTouchpad();
  gesture.update({ active: true, contactId: 1, x: 0.4, y: 0.6 });
  const commits = [];
  for (const [dx, dy] of points) {
    const steps = gesture.update({ active: true, contactId: 1, x: 0.4 + dx / 1920, y: 0.6 + dy / 1080 });
    if (steps.length) commits.push(Array.from(steps));
  }
  assert.deepEqual(commits, [['up', 'right']], 'A to W stays atomic even if the diagonal starts on a single axis');
}
for (const [degrees, expected] of [[31, ['right']], [34, ['down', 'right']], [56, ['down', 'right']], [59, ['down']]]) {
  const gesture = new navigation.RelativeKeyboardTouchpad();
  gesture.update({ active: true, contactId: 1, x: 0.4, y: 0.4 });
  const angle = degrees * Math.PI / 180;
  const steps = gesture.update({ active: true, contactId: 1, x: 0.4 + 250 * Math.cos(angle) / 1920, y: 0.4 + 250 * Math.sin(angle) / 1080 });
  assert.deepEqual(Array.from(steps), expected, 'diagonal entry respects the 32.5 to 57.5 degree range');
}
const relativeSample = { active: true, contactId: 1, x: 0.8, y: 0.8 };
for (const [dx, dy, expected] of [[180, 55, 'right'], [-180, 55, 'left'], [180, 90, 'right'], [32, 105, 'down'], [32, -105, 'up'], [60, 110, 'down']]) {
  const gesture = new navigation.RelativeKeyboardTouchpad();
  gesture.update({ active: true, contactId: 1, x: 0.4, y: 0.5 });
  const steps = [];
  for (let i = 1; i <= 10; i++) {
    steps.push(...gesture.update({ active: true, contactId: 1, x: 0.4 + dx * i / 10 / 1920, y: 0.5 + (dy * i / 10 + (i % 2 ? 2 : -2)) / 1080 }));
  }
  assert.deepEqual(Array.from(steps), [expected], 'slightly crooked cardinal gestures must not become diagonal');
}
assert.equal(relative.update(relativeSample).length, 0, 'first touch establishes a baseline without repositioning');
assert.equal(relative.update(relativeSample).length, 0, 'stationary contact never moves focus');
assert.equal(relative.update({ ...relativeSample, x: 0.83 }).length, 0, 'small motion stays on the selected key');
assert.equal(relative.update({ ...relativeSample, x: 0.86 }).length, 0, 'horizontal selection requires more deliberate travel');
assert.equal(relative.update({ ...relativeSample, x: 0.88 }).length, 0);
assert.ok(relative.getDragProgress().x > 0.85, 'drag progress rises before the key changes');
assert.equal(relative.update({ ...relativeSample, x: 0.89 })[0], 'right');
relative.update({ ...relativeSample, active: false });
assert.equal(relative.getDragProgress().x, 0, 'lifting the finger releases the selector pull');
assert.equal(relative.update({ ...relativeSample, x: 0.1, y: 0.1 }).length, 0, 'retouching elsewhere keeps the selected key');
assert.equal(relative.update({ ...relativeSample, x: 0.1, y: 0.19 })[0], 'down');
assert.equal(relative.update({ ...relativeSample, x: 0.9, y: 0.23 }).length, 1, 'a sudden jump never skips multiple keys in one report');
assert.equal(relative.update({ ...relativeSample, x: 0.9, y: 0.23 }).length, 0, 'a stationary finger does not spend leftover movement');
const guard = new navigation.TouchpadActivationGuard();
assert.ok(guard.allow('A', 0));
assert.equal(guard.allow('A', 100), false);
assert.equal(guard.allow('B', 110), false);
assert.ok(guard.allow('B', 150));
assert.equal(guard.allow('B', 350), false);
assert.ok(guard.allow('B', 450));
const rows = [Array(10).fill({}), Array(10).fill({}), Array(10).fill({}), Array(10).fill({}), [{ colSpan: 4 }, { colSpan: 2 }, { colSpan: 2 }, { colSpan: 2 }]];
const pos = (p) => JSON.parse(JSON.stringify(p));
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 1, 9, 1)), { row: 2, col: 0 });
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 2, 0, -1)), { row: 1, col: 9 });
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 4, 3, 1)), { row: 0, col: 0 });
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 0, 0, -1)), { row: 4, col: 3 });
for (let col = 0; col < 10; col++) {
  const expected = col < 4 ? 0 : col < 6 ? 1 : col < 8 ? 2 : 3;
  assert.deepEqual(pos(navigation.moveKeyboardVertical(rows, 3, col, 1)), { row: 4, col: expected }, 'vertical navigation follows button spans');
}
assert.deepEqual(pos(navigation.moveKeyboardVertical(rows, 4, 1, -1)), { row: 3, col: 5 });
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 4, 2, 1)), { row: 4, col: 3 }, 'right from Clear reaches Results before wrapping');
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 4, 3, 1, false)), { row: 4, col: 3 }, 'touchpad stops at the last button');
assert.deepEqual(pos(navigation.moveKeyboardHorizontal(rows, 1, 0, -1, false)), { row: 1, col: 0 }, 'touchpad stops at the first character');

let now = 0;
class Device extends EventTarget {
  vendorId = 0x054c; productId = 0x0ce6; opened = false; closeCount = 0;
  async open() { this.opened = true; }
  async close() { this.opened = false; this.closeCount++; }
  async receiveFeatureReport(id) { assert.equal(id, 5); }
}
const device = new Device();
const hid = new EventTarget();
hid.getDevices = async () => [device];
hid.requestDevice = async () => [device];
const touch = load('src/services/dualsenseTouchpad.ts', undefined, { navigator: { hid }, performance: { now: () => now } });
function report({ bluetooth = false, active = true, x = 960, y = 540, clicked = false, id = 1 } = {}) {
  const data = new DataView(new ArrayBuffer(bluetooth ? 77 : 63));
  const offset = bluetooth ? 1 : 0;
  for (let index = 0; index < 4; index++) data.setUint8(index + offset, 128);
  data.setUint8(7 + offset, 8);
  data.setUint8(32 + offset, id | (active ? 0 : 0x80));
  data.setUint8(33 + offset, x & 255);
  data.setUint8(34 + offset, ((x >> 8) & 15) | ((y & 15) << 4));
  data.setUint8(35 + offset, y >> 4);
  data.setUint8(9 + offset, clicked ? 2 : 0);
  const event = new Event('inputreport');
  event.data = data; event.reportId = bluetooth ? 0x31 : 1;
  return event;
}
for (const bluetooth of [false, true]) {
  const event = report({ bluetooth });
  const sample = touch.decodeDualSenseTouchpad(event.reportId, event.data);
  assert.equal(sample.x, 0.5); assert.equal(sample.y, 0.5); assert.equal(sample.active, true);
}
assert.equal(touch.decodeDualSenseTouchpad(1, new DataView(new ArrayBuffer(9))), null);

const sound = { SoundService: new Proxy({}, { get: () => () => {} }) };
const pads = [];
const { GamepadManager: manager } = load('src/services/gamepad.ts', () => sound, {
  navigator: { getGamepads: () => pads }, document: {}, window: {},
});
const actions = [];
const nativePulses = [];
const hapticManager = load('src/services/gamepad.ts', (name) => name.includes('dualsenseTouchpad')
  ? { pulseNativeDualSense: (...args) => { nativePulses.push(args); return true; } } : sound,
  { navigator: { getGamepads: () => [{ id: 'DualSense', buttons: [], axes: [] }] } }).GamepadManager;
hapticManager.pulseHaptic(28, 0.45, 0.18);
assert.deepEqual(nativePulses[0], [28, 0.45, 0.18], 'DualSense rumble reaches the native transport even without a browser actuator');
manager.subscribe((action) => actions.push(action));
function key(key, options = {}) {
  return { key, target: { closest: () => null }, preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, ...options };
}
manager.handleKeyboard(key('1')); assert.equal(actions.pop(), 'TRIGGER_LT');
manager.handleKeyboard(key('PageUp')); assert.equal(actions.pop(), 'TRIGGER_LB');
manager.handleKeyboard(key('f')); assert.equal(actions.pop(), 'BUTTON_VIEW');
manager.handleKeyboard(key('Tab')); assert.equal(actions.length, 0);
manager.handleKeyboard(key('x', { repeat: true })); assert.equal(actions.length, 0);
manager.handleKeyboard(key('x', { ctrlKey: true })); assert.equal(actions.length, 0);
manager.handleKeyboard(key('Enter', { target: { closest: (selector) => selector.startsWith('button') ? {} : null } }));
assert.equal(actions.length, 0, 'native button confirmation must not select a background card');
const pad = { id: 'DualSense', buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
pads.push(pad);
manager.markKeyboardActive(); manager.poll(1);
assert.equal(manager.activeControllerType, 'keyboard', 'an idle controller must not replace keyboard hints');
pad.buttons[17] = { pressed: true, value: 1 }; manager.poll(2);
assert.equal(manager.activeControllerType, 'playstation');
assert.equal(actions.pop(), 'TOUCHPAD_CLICK');
pad.buttons[17] = { pressed: false, value: 0 }; manager.poll(3);
const staleHid = touch.decodeDualSenseGamepad(1, report().data);
manager.setHidGamepad(staleHid);
pad.buttons[0] = { pressed: true, value: 1 }; manager.poll(4);
assert.equal(actions.pop(), 'ACTION_A', 'HID must not overwrite a physical button press');
pad.buttons[0] = { pressed: false, value: 0 }; manager.poll(5);
manager.setHidGamepad(null);

// Execute SearchModal's keyboard effect with hook mocks to exercise the two listener paths.
const effects = [], states = [], captures = [], refs = [], callbacks = [];
let closedSearch = 0;
const react = {
  useState(initial) { const index = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
  useRef: (value) => { const ref = { current: value }; refs.push(ref); return ref; }, useMemo: (fn) => fn(), useCallback: (fn) => { callbacks.push(fn); return fn; },
  useEffect: (fn) => effects.push(fn),
};
const SearchModal = load('src/components/SearchModal.tsx', (name) => {
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} };
  if (name.includes('gamepad')) return { GamepadManager: manager };
  if (name.includes('keyboardGel')) return gel;
  if (name.includes('keyboardNavigation')) return navigation;
  if (name.includes('dualsenseTouchpad')) return touch;
  if (name.includes('sound')) return sound;
  return {};
}, { window: { addEventListener: (_, callback) => captures.push(callback), removeEventListener() {} } }).SearchModal;
SearchModal({ onClose() { closedSearch++; }, onSelectItem() {}, allCatalogItems: [{ id: 'x', type: 'movie' }] });
const captureEffect = effects.find((fn) => fn.toString().includes('stopImmediatePropagation'));
captureEffect();
actions.length = 0;
for (const letter of ['q', 'x', 'y', 'w', '1', ' ']) {
  const event = key(letter); captures[0](event); if (!event.stopped) manager.handleKeyboard(event);
}
assert.equal(states[0], 'QXYW1 ');
assert.equal(actions.length, 0, 'typing must not also fire gamepad bindings');
const tab = key('Tab'); captures[0](tab);
assert.equal(states[3], 'results');
const searchSubscription = effects.find((fn) => fn.toString().includes('RESULTS_COLS'))();
refs[0].current = () => {}; // HID connected, but no finger position has arrived.
manager.emit('TOUCHPAD_CLICK');
assert.equal(states[0], 'QXYW1 Q', 'touchpad click must still type when HID has no touch coordinates');
manager.emit('TOUCHPAD_CLICK');
assert.equal(states[0], 'QXYW1 Q', 'contact bounce must not insert the same character twice');
const focusRef = refs.find((ref) => ref.current && Object.hasOwn(ref.current, 'keyRow'));
const handleTouch = callbacks.find((fn) => fn.toString().includes('relativeTouchpadRef.current.update'));
const heldFinger = { active: true, contactId: 7, x: 0.8, y: 0.8, activate: false };
const originalColumn = focusRef.current.keyCol;
handleTouch(heldFinger);
assert.equal(focusRef.current.keyCol, originalColumn);
manager.emit('NAV_RIGHT');
assert.equal(focusRef.current.keyCol, originalColumn + 1);
handleTouch(heldFinger);
assert.equal(focusRef.current.keyCol, originalColumn + 1, 'a resting finger must not undo D-pad selection');
// Exercise the visible selector before a key transition, not just navigation thresholds.
const keyRect = (left) => ({ left, top: 50, width: 80, height: 50 });
const selectorFrames = [];
const selector = {
  style: { left: '100px', top: '50px', width: '80px', height: '50px', visibility: 'visible' },
  getBoundingClientRect() { return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; },
  animate(frames) { selectorFrames.push(frames); return { cancel() {}, playState: 'running' }; },
};
refs[4].current = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
refs[5].current = selector;
refs[6].current.set('W', { getBoundingClientRect: () => keyRect(100) });
refs[6].current.set('E', { getBoundingClientRect: () => keyRect(190) });
handleTouch({ ...heldFinger, x: 0.82 });
const firstPull = parseFloat(selector.style.left) + parseFloat(selector.style.width) / 2;
handleTouch({ ...heldFinger, x: 0.84 });
assert.ok(firstPull >= 140 && parseFloat(selector.style.left) + parseFloat(selector.style.width) / 2 > firstPull, 'selector moves progressively while the selected key stays unchanged');
assert.equal(focusRef.current.keyCol, originalColumn + 1);
assert.ok(parseFloat(selector.style.width) > 80, 'selector stretches toward the neighbor while dragging');
// A running snap must not block subsequent finger updates.
refs[7].current = { playState: 'running', cancel() {} };
handleTouch({ ...heldFinger, x: 0.85 });
assert.ok(parseFloat(selector.style.left) + parseFloat(selector.style.width) / 2 > firstPull, 'dragging overrides a running snap animation');
handleTouch({ ...heldFinger, active: false });
assert.equal(parseFloat(selector.style.left), 96, 'release returns to the current key');
assert.ok(selectorFrames.length > 0, 'release animates back to the selected key');
refs[4].current = null; refs[5].current = null;
focusRef.current.focusZone = 'results';
handleTouch(heldFinger);
assert.equal(focusRef.current.focusZone, 'results', 'touch reports must not steal results focus');
manager.emit('ACTION_B');
assert.equal(focusRef.current.focusZone, 'keyboard');
handleTouch(heldFinger);
manager.emit('ACTION_B');
assert.equal(closedSearch, 1, 'Circle must close search even while a finger rests on the touchpad');
searchSubscription();

(async () => {
  const samples = [];
  const cleanup = await touch.connectDualSenseTouchpad((sample) => samples.push(sample), () => {});
  device.dispatchEvent(report()); now = 100;
  device.dispatchEvent(report({ active: false }));
  assert.equal(samples.filter((s) => s.activate).length, 1, 'short tap types once');
  samples.length = 0; now = 200;
  device.dispatchEvent(report());
  device.dispatchEvent(report({ clicked: true }));
  device.dispatchEvent(report({ clicked: true }));
  device.dispatchEvent(report({ active: false }));
  assert.equal(samples.filter((s) => s.activate).length, 0, 'physical click is handled by GamepadManager and must not also generate a HID tap');
  samples.length = 0; now = 300;
  device.dispatchEvent(report()); device.dispatchEvent(report({ x: 1600 }));
  device.dispatchEvent(report({ active: false }));
  assert.equal(samples.filter((s) => s.activate).length, 0, 'swipe only moves focus');
  cleanup(); device.dispatchEvent(report());
  await new Promise(setImmediate);
  assert.equal(device.closeCount, 1);
  const first = await touch.connectDualSenseTouchpad(() => {}, () => {});
  const second = await touch.connectDualSenseTouchpad(() => {}, () => {});
  first();
  assert.equal(device.opened, true, 'overlapping mounts must retain the live HID connection');
  second();
  await new Promise(setImmediate);
  assert.equal(device.closeCount, 2);
  // Reopening while close is pending must wait for that operation to finish.
  let finishClose;
  device.close = async () => { await new Promise((resolve) => { finishClose = resolve; }); device.opened = false; device.closeCount++; };
  const third = await touch.connectDualSenseTouchpad(() => {}, () => {});
  third();
  await new Promise(setImmediate);
  const fourthPromise = touch.connectDualSenseTouchpad(() => {}, () => {});
  finishClose();
  const fourth = await fourthPromise;
  assert.equal(device.opened, true);
  const hidSample = report({ clicked: true });
  hidSample.data.setUint8(7, 0x28); // Cross pressed, D-pad neutral.
  hidSample.data.setUint8(4, 255); // L2 fully pressed.
  const decodedPad = touch.decodeDualSenseGamepad(hidSample.reportId, hidSample.data);
  assert.equal(decodedPad.buttons[0].pressed, true);
  assert.equal(decodedPad.buttons[6].value, 1);
  assert.equal(decodedPad.buttons[17].pressed, true);
  const shortReport = new DataView(new ArrayBuffer(9));
  shortReport.setUint8(4, 0x28); shortReport.setUint8(6, 2); shortReport.setUint8(7, 255);
  const basicPad = touch.decodeDualSenseGamepad(1, shortReport);
  assert.equal(basicPad.buttons[0].pressed, true);
  assert.equal(basicPad.buttons[17].pressed, true);
  assert.equal(basicPad.buttons[6].value, 1);
  const silentNative = { ...pad, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  pads.length = 0; pads.push(silentNative);
  manager.poll(6); actions.length = 0;
  manager.setHidGamepad(decodedPad); manager.poll(7);
  assert.ok(actions.includes('TOUCHPAD_CLICK'), 'HID supplies the touchpad click when native Gamepad API omits button 17');
  assert.ok(!actions.includes('ACTION_A'), 'native face buttons remain authoritative');
  silentNative.timestamp = 0;
  manager.poll(8);
  assert.ok(actions.includes('ACTION_A'), 'fresh HID reports recover buttons when Bluetooth leaves a stale native snapshot');
  manager.setHidGamepad(touch.decodeDualSenseGamepad(1, report().data));
  manager.poll(9);
  actions.length = 0;
  const stickAndCircle = report();
  stickAndCircle.data.setUint8(0, 255);
  stickAndCircle.data.setUint8(7, 0x48);
  manager.setHidGamepad(touch.decodeDualSenseGamepad(1, stickAndCircle.data));
  manager.poll(10);
  assert.ok(actions.includes('NAV_RIGHT'), 'analog stick navigates while native Bluetooth input is stale');
  assert.ok(actions.includes('ACTION_B'), 'Circle remains available alongside touchpad input');
  silentNative.timestamp = 999999;
  manager.setHidGamepad(touch.decodeDualSenseGamepad(1, report().data), true);
  manager.poll(11);
  actions.length = 0;
  manager.markKeyboardActive();
  manager.handleKeyboard(key('x', { isTrusted: false }));
  manager.setHidGamepad(touch.decodeDualSenseGamepad(1, stickAndCircle.data), true);
  manager.poll(12);
  assert.ok(actions.includes('ACTION_B'), 'authoritative HID input works regardless of native timestamps and keyboard mode');
  assert.equal(manager.activeControllerType, 'playstation', 'real controller commands restore controller hints');
  pads.length = 0;
  manager.setHidGamepad(null);
  manager.poll(13);
  assert.equal(manager.activeControllerType, 'playstation', 'a brief source outage must not switch to keyboard');
  manager.setHidGamepad(touch.decodeDualSenseGamepad(1, report().data));
  manager.poll(11);
  pads.length = 0; actions.length = 0;
  manager.setHidGamepad(decodedPad); manager.poll(3);
  assert.ok(actions.includes('ACTION_A'), 'ordinary buttons keep working when native Gamepad API disappears');
  assert.ok(actions.includes('TRIGGER_LT'));
  manager.setHidGamepad(null);
  assert.equal(manager.getActiveGamepad(), null);
  fourth();
  await new Promise(setImmediate);
  finishClose();
  // The browser receives native reports through EventSource without opening WebHID.
  let source;
  let sourceCount = 0;
  class NativeSource {
    constructor() { source = this; sourceCount++; }
    close() { this.closed = true; }
  }
  const nativeSamples = [];
  const nativeClient = load('src/services/dualsenseTouchpad.ts', undefined, {
    navigator: {}, AbortSignal, EventSource: NativeSource, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ available: true }) }),
    performance: { now: () => now },
  });
  const releaseNative = await nativeClient.connectDualSenseTouchpad((event) => nativeSamples.push(event), () => {});
  const sendNative = (event) => source.onmessage({ data: JSON.stringify({ reportId: event.reportId, bytes: Array.from(new Uint8Array(event.data.buffer)) }) });
  sendNative(report({ bluetooth: true })); now += 100;
  sendNative(report({ bluetooth: true, active: false }));
  assert.equal(nativeSamples.filter((sample) => sample.activate).length, 1);
  releaseNative(); assert.equal(source.closed, true);
  let rootReports = 0;
  const stopRoot = nativeClient.subscribeDualSenseTouchpad(() => {}, (pad) => { if (pad) rootReports++; });
  await new Promise(setImmediate);
  const persistentSource = source;
  for (let cycle = 0; cycle < 20; cycle++) {
    const stopSearch = nativeClient.subscribeDualSenseTouchpad(() => {});
    sendNative(report({ bluetooth: true, active: false }));
    stopSearch();
    assert.ok(!persistentSource.closed, 'closing search must retain controller input for the app');
  }
  assert.equal(sourceCount, 2, 'all search mounts share one persistent controller connection');
  assert.equal(rootReports, 20);
  source.onerror();
  sendNative(report({ bluetooth: true, active: false }));
  assert.equal(rootReports, 21, 'input resumes after a transient stream error');
  stopRoot();
  assert.equal(persistentSource.closed, true, 'only the last app subscriber closes the connection');
  // Search requests access automatically while browser user activation is available.
  const permissionCalls = [];
  const activation = { isActive: true };
  const automaticListeners = new Map();
  const autoTouch = { ...touch,
    subscribeDualSenseTouchpad: () => { permissionCalls.push(false); return () => {}; },
    requestDualSenseTouchpadPermission: () => permissionCalls.push(true),
  };
  effects.length = 0; states.length = 0;
  pads.push(pad);
  const AutomaticSearch = load('src/components/SearchModal.tsx', (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} };
    if (name.includes('gamepad')) return { GamepadManager: manager };
    if (name.includes('keyboardGel')) return gel;
  if (name.includes('keyboardNavigation')) return navigation;
    if (name.includes('dualsenseTouchpad')) return autoTouch;
    if (name.includes('sound')) return sound;
    return {};
  }, { navigator: { userActivation: activation }, window: {
    addEventListener: (name, callback) => automaticListeners.set(name, callback),
    removeEventListener: (name) => automaticListeners.delete(name),
  } }).SearchModal;
  AutomaticSearch({ onClose() {}, onSelectItem() {}, allCatalogItems: [] });
  const automaticEffect = effects.find((fn) => fn.toString().includes('permissionRequested'));
  const stopAuto = automaticEffect();
  await new Promise(setImmediate);
  assert.deepEqual(permissionCalls, [false, true]);
  stopAuto();
  assert.equal(automaticListeners.size, 0);
  permissionCalls.length = 0; activation.isActive = false;
  const stopDeferred = automaticEffect();
  await new Promise(setImmediate);
  assert.deepEqual(permissionCalls, [false]);
  activation.isActive = true;
  automaticListeners.get('keydown')({ isTrusted: true });
  await new Promise(setImmediate);
  assert.deepEqual(permissionCalls, [false, true]);
  stopDeferred();
  console.log('Input checks passed: row wrapping, bindings, search typing, USB/Bluetooth reports, taps, clicks, swipes and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
