// Layout and Bluetooth checksum: https://github.com/nondebug/dualsense/blob/main/dualsense-explorer.html
export function dualsenseRumbleReport(bluetooth: boolean, sequence: number, weak: number, strong: number): Buffer {
  const report = Buffer.alloc(bluetooth ? 78 : 48);
  report[0] = bluetooth ? 0x31 : 0x02;
  const common = bluetooth ? 3 : 1;
  if (bluetooth) { report[1] = (sequence & 15) << 4; report[2] = 0x10; }
  // Enable only compatible vibration and select rumble; leave lights, audio and triggers alone.
  report[common] = 0x03;
  report[common + 2] = Math.round(Math.max(0, Math.min(1, weak)) * 255);
  report[common + 3] = Math.round(Math.max(0, Math.min(1, strong)) * 255);
  if (bluetooth) {
    let crc = 0xffffffff;
    for (const byte of [0xa2, ...report.subarray(0, 74)]) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    report.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 74);
  }
  return report;
}
