const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const listeners = [];
const calls = [];
const events = [];
let available = true;
const windowMock = {
  __TAURI_INTERNALS__: { invoke: async (command) => { calls.push(command); return available; } },
  addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
  removeEventListener: (type, handler, capture) => {
    const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
    if (index >= 0) listeners.splice(index, 1);
  },
  dispatchEvent: (event) => events.push(event.type),
};
const service = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/system.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: service, window: windowMock, console, Event });
(async () => {
  const dispose = service.installSteamOverlayShortcut();
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].capture, true, 'overlay must precede modal and bubble navigation');
  const key = (overrides = {}) => ({ key: 'Tab', shiftKey: true, repeat: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides });
  const dispatch = (event) => { listeners[0].handler(event); return event; };
  const shiftedTab = dispatch(key());
  assert.equal(shiftedTab.prevented, true);
  assert.equal(shiftedTab.stopped, true, 'search must not toggle its focus zone');
  assert.deepEqual(calls, ['activate_steam_overlay']);
  dispatch(key({ repeat: true }));
  assert.equal(calls.length, 1, 'held shortcut opens overlay only once');
  const pending = service.activateSteamOverlay();
  assert.equal(service.activateSteamOverlay(), pending, 'rapid presses share a single pending native request');
  await pending;
  for (const modifiers of [{ shiftKey: false }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    const event = dispatch(key(modifiers));
    assert.equal(event.prevented, undefined);
  }
  available = false;
  assert.equal(await service.activateSteamOverlay(), false);
  assert.ok(events.includes('steam-overlay-unavailable'), 'failure is visible instead of opening Big Picture');
  dispose();
  assert.equal(listeners.length, 0);
  delete windowMock.__TAURI_INTERNALS__;
  service.installSteamOverlayShortcut()();
  assert.equal(listeners.length, 0, 'browser Shift+Tab remains native focus navigation');
  console.log('Steam shortcut tests passed: capture, modal isolation, repeat, modifiers, feedback and browser focus.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
