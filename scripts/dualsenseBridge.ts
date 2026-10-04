import { devicesAsync, HIDAsync } from 'node-hid';
import type { ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { dualsenseRumbleReport } from './dualsenseRumble.js';

// Keep raw Bluetooth touch reports on the local app server, avoiding WebHID's browser chooser.
export function dualsenseBridge(): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    const clients = new Set<ServerResponse>();
    let device: HIDAsync | null = null;
    let connecting = false;
    let stopped = false;
    let signature = '';
    let fullReportRequested = false;
    let closing = Promise.resolve();
    let lastSent = 0;
    let bluetooth: boolean | null = null;
    let sequence = 0;
    let writes = Promise.resolve();
    let rumbleTimer: ReturnType<typeof setTimeout> | undefined;
    const writeRumble = (current: HIDAsync, weak: number, strong: number) => {
      const report = dualsenseRumbleReport(bluetooth === true, sequence++, weak, strong);
      const pending = writes.then(async () => {
        if (device !== current) return;
        await current.write(report);
      });
      writes = pending.catch(() => {});
      return pending;
    };
    const closeDevice = async () => {
      const current = device;
      clearTimeout(rumbleTimer);
      if (current && bluetooth !== null) await writeRumble(current, 0, 0).catch(() => {});
      device = null;
      bluetooth = null;
      signature = '';
      if (current) {
        closing = current.close().catch(() => {});
        await closing;
      }
    };
    const connect = async () => {
      if (stopped || connecting || device || !clients.size) return;
      connecting = true;
      try {
        await closing;
        const devices = await devicesAsync();
        const info = devices.find((entry) => entry.vendorId === 0x054c &&
          [0x0ce6, 0x0df2].includes(entry.productId) && entry.usagePage === 1 && entry.usage === 5);
        if (!info?.path) return;
        const opened = await HIDAsync.open(info.path, { nonExclusive: true });
        if (stopped || !clients.size) { await opened.close(); return; }
        device = opened;
        fullReportRequested = false;
        opened.on('error', () => { if (device === opened) void closeDevice(); });
        opened.on('data', (buffer: Buffer) => {
          if (device !== opened || !clients.size) return;
          const reportId = buffer[0];
          bluetooth = reportId === 0x31 || (reportId === 1 && buffer.length === 78);
          // Windows pads basic Bluetooth report 0x01 to 78 bytes. Trim to its real payload.
          const bytes = reportId === 1 && buffer.length === 78 ? buffer.subarray(1, 10) : buffer.subarray(1);
          if (reportId === 1 && bytes.length === 9 && !fullReportRequested) {
            fullReportRequested = true;
            void opened.getFeatureReport(0x05, 41).catch(() => {});
          }
          if (![1, 0x31].includes(reportId)) return;
          const offset = reportId === 0x31 ? 1 : 0;
          const current = bytes.length === 9 ? bytes.toString('hex')
            : `${reportId}:${bytes.subarray(offset, 6 + offset).toString('hex')}:${bytes.subarray(7 + offset, 10 + offset).toString('hex')}:${bytes.subarray(32 + offset, 40 + offset).toString('hex')}`;
          if (current === signature && Date.now() - lastSent < 500) return;
          signature = current;
          lastSent = Date.now();
          const message = `data: ${JSON.stringify({ reportId, bytes: Array.from(bytes) })}\n\n`;
          for (const client of clients) if (client.writableLength < 65536) client.write(message);
        });
      } catch (error) {
        console.debug('[DualSense] Não foi possível abrir a leitura local:', error);
      } finally {
        connecting = false;
      }
    };
    const reconnect = setInterval(() => { void connect(); }, 3000);
    const keepalive = setInterval(() => { for (const client of clients) client.write(': keepalive\n\n'); }, 10000);
    reconnect.unref(); keepalive.unref();
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__dualsense/')) return next();
      const remote = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote || '') ||
        (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
        res.writeHead(403); res.end(); return;
      }
      if (req.url === '/__dualsense/status') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ available: true, connected: !!device }));
        return;
      }
      if (req.url.startsWith('/__dualsense/rumble?')) {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        const params = new URL(req.url, 'http://localhost').searchParams;
        const duration = Number(params.get('duration'));
        const weak = Number(params.get('weak'));
        const strong = Number(params.get('strong'));
        if (![duration, weak, strong].every(Number.isFinite) || duration < 1 || duration > 1000 || weak < 0 || weak > 1 || strong < 0 || strong > 1) {
          res.writeHead(400); res.end(); return;
        }
        const current = device;
        if (!current || bluetooth === null) { res.writeHead(503); res.end(); return; }
        clearTimeout(rumbleTimer);
        void writeRumble(current, weak, strong).then(() => {
          clearTimeout(rumbleTimer);
          rumbleTimer = setTimeout(() => { void writeRumble(current, 0, 0).catch(() => {}); }, duration);
          res.writeHead(204); res.end();
        }).catch(() => { res.writeHead(503); res.end(); });
        return;
      }
      if (req.url !== '/__dualsense/events') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      void connect();
      res.on('close', () => {
        clients.delete(res);
        if (!clients.size) void closeDevice();
      });
    });
    server.httpServer?.on('close', () => {
      stopped = true; clearInterval(reconnect); clearInterval(keepalive);
      for (const client of clients) client.end();
      clients.clear(); void closeDevice();
    });
  };
  return { name: 'dualsense-local-touchpad', configureServer: install, configurePreviewServer: install };
}
