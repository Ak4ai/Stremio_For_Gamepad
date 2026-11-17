// Report offsets exclude the report ID. USB 0x01 and Bluetooth 0x31 layouts:
// https://github.com/nondebug/dualsense/blob/main/dualsense-explorer.html
import { getTauriInvoker } from './system';

export interface TouchpadSample {
  active: boolean;
  contactId: number;
  x: number;
  y: number;
  clicked: boolean;
}

export function decodeDualSenseTouchpad(reportId: number, data: DataView): TouchpadSample | null {
  const offset = reportId === 0x31 && data.byteLength === 77 ? 1
    : reportId === 0x01 && data.byteLength === 63 ? 0 : -1;
  if (offset < 0) return null;
  const contact = data.getUint8(32 + offset);
  const packed = data.getUint8(34 + offset);
  return {
    active: (contact & 0x80) === 0,
    contactId: contact & 0x7f,
    x: Math.min(1, (data.getUint8(33 + offset) | ((packed & 0x0f) << 8)) / 1920),
    y: Math.min(1, ((packed >> 4) | (data.getUint8(35 + offset) << 4)) / 1080),
    clicked: (data.getUint8(9 + offset) & 0x02) !== 0,
  };
}

interface HidDevice extends EventTarget {
  vendorId: number;
  productId: number;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  receiveFeatureReport(id: number): Promise<DataView>;
}
interface HidApi extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<HidDevice[]>;
}
interface HidInputEvent extends Event { reportId: number; data: DataView; sampleTime?: number }
const productIds = [0x0ce6, 0x0df2];
// StrictMode may mount two sessions before the first asynchronous open completes.
const connections = new WeakMap<HidDevice, { users: number; owned: boolean; ready: Promise<void> }>();
function getHid(): HidApi | undefined {
  return (navigator as Navigator & { hid?: HidApi }).hid;
}

export const isTouchpadSupported = () => !!getHid() || typeof EventSource !== 'undefined';
export type TouchpadEvent = TouchpadSample & { activate: boolean };

type Subscriber = { touch: (event: TouchpadEvent) => void; gamepad?: (pad: Gamepad | null) => void };
const subscribers = new Set<Subscriber>();
let sharedCleanup: (() => void) | null = null;
let sharedOpening: Promise<void> | null = null;
let sharedGeneration = 0;
let permissionQueued = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let nativeTransport = false;
let tauriTransport = false;
let nativeConnected = false;
let nativeOverlayActive = false;

export function pulseNativeDualSense(duration: number, weak: number, strong: number): boolean {
  if (tauriTransport) {
    if (!nativeConnected) return false;
    const invoke = getTauriInvoker();
    if (!invoke) return false;
    void invoke('dualsense_rumble', { duration: Math.max(1, Math.min(1000, Math.round(duration))), weak, strong }).catch(() => {});
    return true;
  }
  if (!nativeTransport) return false;
  const params = new URLSearchParams({ duration: String(Math.max(1, Math.min(1000, duration))), weak: String(weak), strong: String(strong) });
  void fetch(`/__dualsense/rumble?${params}`, { method: 'POST' }).catch(() => {});
  return true;
}

function shareTouch(event: TouchpadEvent) {
  for (const subscriber of subscribers) {
    try { subscriber.touch(event); } catch (error) { console.error('Falha ao processar touchpad:', error); }
  }
}
function shareGamepad(pad: Gamepad | null) {
  for (const subscriber of subscribers) {
    try { subscriber.gamepad?.(pad); } catch (error) { console.error('Falha ao processar controle:', error); }
  }
}
function openShared(choose: boolean) {
  if (!subscribers.size || sharedCleanup) return;
  if (sharedOpening) { permissionQueued ||= choose; return; }
  const generation = ++sharedGeneration;
  sharedOpening = connectDualSenseTouchpad(shareTouch, () => {
    sharedCleanup = null;
    shareGamepad(null);
    reconnectTimer = setTimeout(() => openShared(false), 1500);
  }, choose, shareGamepad).then((cleanup) => {
    if (!subscribers.size || generation !== sharedGeneration) cleanup?.();
    else sharedCleanup = cleanup;
  }).catch((error) => console.debug('Leitura DualSense indisponível:', error)).finally(() => {
    sharedOpening = null;
    const queued = permissionQueued;
    permissionQueued = false;
    if (subscribers.size && !sharedCleanup && (generation !== sharedGeneration || queued)) openShared(queued);
  });
}

export function subscribeDualSenseTouchpad(touch: (event: TouchpadEvent) => void,
  gamepad?: (pad: Gamepad | null) => void, choose = false): () => void {
  const subscriber = { touch, gamepad };
  subscribers.add(subscriber);
  openShared(choose);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) {
      sharedGeneration++;
      clearTimeout(reconnectTimer);
      sharedCleanup?.();
      sharedCleanup = null;
      permissionQueued = false;
      gamepad?.(null);
    }
  };
}

export function requestDualSenseTouchpadPermission() { openShared(true); }

export function decodeDualSenseGamepad(reportId: number, data: DataView): Gamepad | null {
  const basicBluetooth = reportId === 0x01 && data.byteLength === 9;
  const offset = reportId === 0x31 && data.byteLength === 77 ? 1
    : reportId === 0x01 && (data.byteLength === 63 || basicBluetooth) ? 0 : -1;
  if (offset < 0) return null;
  const face = data.getUint8((basicBluetooth ? 4 : 7) + offset);
  const shoulder = data.getUint8((basicBluetooth ? 5 : 8) + offset);
  const extra = data.getUint8((basicBluetooth ? 6 : 9) + offset);
  const leftTrigger = data.getUint8((basicBluetooth ? 7 : 4) + offset) / 255;
  const rightTrigger = data.getUint8((basicBluetooth ? 8 : 5) + offset) / 255;
  const hat = face & 15;
  const values = [face & 0x20, face & 0x40, face & 0x10, face & 0x80,
    shoulder & 1, shoulder & 2, leftTrigger, rightTrigger,
    shoulder & 0x10, shoulder & 0x20, shoulder & 0x40, shoulder & 0x80,
    [0, 1, 7].includes(hat), [3, 4, 5].includes(hat), [5, 6, 7].includes(hat), [1, 2, 3].includes(hat),
    extra & 1, extra & 2];
  return {
    id: 'Sony DualSense (WebHID)', index: -1, connected: true, mapping: 'standard', timestamp: performance.now(), vibrationActuator: null,
    axes: [0, 1, 2, 3].map((index) => data.getUint8(index + offset) / 127.5 - 1),
    buttons: values.map((value, index) => ({ pressed: index === 6 || index === 7 ? Number(value) > 0.5 : !!value,
      touched: !!value, value: index === 6 || index === 7 ? Number(value) : value ? 1 : 0 })),
  // HID supplies input only; browser typings require an actuator that is optional in practice.
  } as unknown as Gamepad;
}

export async function connectDualSenseTouchpad(
  onTouch: (event: TouchpadEvent) => void,
  onDisconnect: () => void,
  chooseDevice = false,
  onGamepad?: (gamepad: Gamepad | null) => void,
): Promise<(() => void) | null> {
  const invoke = getTauriInvoker();
  if (invoke) {
    type NativeBatch = { connected: boolean; nowMs: number; reports: { reportId: number; bytes: number[]; timestampMs: number }[] };
    // This IPC reader is part of the installed executable, including without
    // Vite, Node, a localhost server, or a browser HID permission dialog.
    const first = await invoke('dualsense_poll') as NativeBatch;
    tauriTransport = true;
    const receiver = new EventTarget();
    const nativeHid = {
      vendorId: 0x054c, productId: 0x0ce6, opened: true,
      open: async () => {}, close: async () => {}, receiveFeatureReport: async () => new DataView(new ArrayBuffer(0)),
      addEventListener: receiver.addEventListener.bind(receiver), removeEventListener: receiver.removeEventListener.bind(receiver),
    } as unknown as HidDevice;
    const cleanup = await attachDevice(nativeHid, new EventTarget() as HidApi, (event) => {
      if (!nativeOverlayActive) onTouch(event);
    }, onDisconnect, (pad) => {
      if (pad) {
        pad = { ...pad, id: 'Sony DualSense (Native HID)', buttons: Array.from(pad.buttons) } as Gamepad;
        // The Rust HID reader owns PS-button edges, including while the webview
        // is unfocused. Browser delivery must not forward the same press again.
        (pad.buttons as GamepadButton[])[16] = { pressed: false, touched: false, value: 0 };
      }
      onGamepad?.(pad);
    });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasConnected = false;
    let ignoreBefore = -Infinity;
    const receive = (batch: NativeBatch) => {
      nativeConnected = batch.connected;
      if (!batch.connected && wasConnected) {
        onGamepad?.(null);
        onTouch({ active: false, contactId: 0, x: 0, y: 0, clicked: false, activate: false });
      }
      wasConnected = batch.connected;
      const now = performance.now();
      for (const packet of batch.reports) {
        const report = new Event('inputreport') as HidInputEvent;
        report.reportId = packet.reportId;
        report.data = new DataView(Uint8Array.from(packet.bytes).buffer);
        report.sampleTime = now - Math.max(0, batch.nowMs - packet.timestampMs);
        if (report.sampleTime < ignoreBefore) continue;
        receiver.dispatchEvent(report);
      }
    };
    const overlayState = (event: Event) => {
      nativeOverlayActive = (event as CustomEvent<boolean>).detail === true;
      if (nativeOverlayActive) {
        receiver.dispatchEvent(new Event('overlay-interrupt'));
        onTouch({ active: false, contactId: 0, x: 0, y: 0, clicked: false, activate: false });
      } else { ignoreBefore = performance.now(); }
    };
    window.addEventListener('steam-overlay-state', overlayState);
    const poll = async () => {
      try {
        const batch = await invoke('dualsense_poll') as NativeBatch;
        if (!stopped) receive(batch);
      } catch (error) {
        if (!stopped) { nativeConnected = false; onGamepad?.(null); console.debug('Falha na leitura HID nativa:', error); }
      } finally {
        if (!stopped) timer = setTimeout(poll, 12);
      }
    };
    receive(first);
    timer = setTimeout(poll, 12);
    return () => {
      stopped = true; clearTimeout(timer); cleanup();
      window.removeEventListener('steam-overlay-state', overlayState);
      nativeConnected = false; tauriTransport = false; nativeOverlayActive = false;
    };
  }
  if (typeof fetch !== 'undefined' && typeof EventSource !== 'undefined') {
    try {
      const status = await fetch('/__dualsense/status', { signal: AbortSignal.timeout(1000) });
      if (status.ok && (await status.json()).available) {
        nativeTransport = true;
        const source = new EventSource('/__dualsense/events');
        const receiver = new EventTarget();
        const nativeHid = {
          vendorId: 0x054c, productId: 0x0ce6, opened: true,
          open: async () => {}, close: async () => {}, receiveFeatureReport: async () => new DataView(new ArrayBuffer(0)),
          addEventListener: receiver.addEventListener.bind(receiver), removeEventListener: receiver.removeEventListener.bind(receiver),
        } as unknown as HidDevice;
        source.onmessage = (message) => {
          const packet = JSON.parse(message.data) as { reportId: number; bytes: number[] };
          const report = new Event('inputreport') as HidInputEvent;
          report.reportId = packet.reportId;
          report.data = new DataView(Uint8Array.from(packet.bytes).buffer);
          receiver.dispatchEvent(report);
        };
        source.onerror = () => {
          onGamepad?.(null);
          onTouch({ active: false, contactId: 0, x: 0, y: 0, clicked: false, activate: false });
        };
        const cleanup = await attachDevice(nativeHid, new EventTarget() as HidApi, onTouch, onDisconnect, onGamepad);
        return () => { source.close(); cleanup(); };
      }
    } catch { /* A remotely hosted frontend falls back to WebHID. */ }
  }
  const hid = getHid();
  if (!hid) throw new Error('Use Chrome ou Edge para ativar o touchpad do DualSense.');
  const devices = chooseDevice
    ? await hid.requestDevice({ filters: productIds.map((productId) => ({ vendorId: 0x054c, productId })) })
    : await hid.getDevices();
  const device = devices.find((entry) => entry.vendorId === 0x054c && productIds.includes(entry.productId));
  if (!device) return null;
  return attachDevice(device, hid, onTouch, onDisconnect, onGamepad);
}

async function attachDevice(device: HidDevice, hid: HidApi, onTouch: (event: TouchpadEvent) => void,
  onDisconnect: () => void, onGamepad?: (gamepad: Gamepad | null) => void): Promise<() => void> {
  let connection = connections.get(device);
  if (!connection) {
    connection = { users: 0, owned: !device.opened, ready: Promise.resolve() };
    connection.ready = connection.owned ? device.open() : Promise.resolve();
    connections.set(device, connection);
  } else if (!connection.users) {
    connection.ready = connection.ready.then(async () => { if (!device.opened) await device.open(); });
  }
  connection.users++;
  try {
    await connection.ready;
  } catch (error) {
    connection.users--;
    if (!connection.users) connections.delete(device);
    throw error;
  }
  const sharedConnection = connection;
  let pressed = false;
  let gesture: { id: number; x: number; y: number; started: number; moved: boolean; clicked: boolean } | null = null;
  let last: TouchpadSample | null = null;
  let requestedFullReport = false;
  let disposed = false;
  let requireLift = false;
  const interrupt = () => { gesture = null; last = null; requireLift = true; };
  const input = (event: Event) => {
    if (disposed) return;
    const report = event as HidInputEvent;
    const sampleTime = report.sampleTime ?? performance.now();
    const gamepad = decodeDualSenseGamepad(report.reportId, report.data);
    if (gamepad) onGamepad?.(gamepad);
    // Only Bluetooth's short report needs this operation; serialize it with open/close.
    if (report.reportId === 1 && report.data.byteLength === 9 && !requestedFullReport) {
      requestedFullReport = true;
      sharedConnection.ready = sharedConnection.ready.then(async () => {
        if (!disposed && device.opened) await device.receiveFeatureReport(0x05);
      }).catch(() => {});
    }
    const sample = decodeDualSenseTouchpad(report.reportId, report.data);
    if (!sample) return;
    if (tauriTransport && nativeOverlayActive) {
      gesture = null; last = null; pressed = sample.clicked; requireLift = sample.active;
      return;
    }
    if (requireLift) {
      requireLift = sample.active;
      if (requireLift) return;
    }
    const click = sample.clicked && !pressed;
    pressed = sample.clicked;
    if (sample.active) {
      if (!gesture || gesture.id !== sample.contactId) {
        gesture = { id: sample.contactId, x: sample.x, y: sample.y, started: sampleTime, moved: false, clicked: false };
      }
      if (Math.hypot((sample.x - gesture.x) * 1920, (sample.y - gesture.y) * 1080) > 18) gesture.moved = true;
      gesture.clicked ||= click;
      last = sample;
      // Physical clicks are handled by GamepadManager; HID handles position and short taps.
      onTouch({ ...sample, activate: false });
    } else {
      const elapsed = gesture ? sampleTime - gesture.started : 0;
      const tap = gesture && !gesture.moved && !gesture.clicked && elapsed >= 45 && elapsed < 260;
      onTouch({ ...(last || sample), active: false, activate: !!tap });
      gesture = null;
    }
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    device.removeEventListener('inputreport', input);
    device.removeEventListener('overlay-interrupt', interrupt);
    hid.removeEventListener('disconnect', disconnected);
    onGamepad?.(null);
    sharedConnection.users--;
    if (!sharedConnection.users) {
      sharedConnection.ready = sharedConnection.ready.then(async () => {
        if (!sharedConnection.users && sharedConnection.owned && device.opened) await device.close();
      }).catch(() => {});
    }
  };
  const disconnected = (event: Event) => {
    if ((event as Event & { device: HidDevice }).device !== device) return;
    cleanup();
    connections.delete(device);
    onDisconnect();
  };
  device.addEventListener('inputreport', input);
  device.addEventListener('overlay-interrupt', interrupt);
  hid.addEventListener('disconnect', disconnected);
  return cleanup;
}
