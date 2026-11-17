use std::{collections::VecDeque, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report { pub report_id: u8, pub bytes: Vec<u8>, pub timestamp_ms: u64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch { pub connected: bool, pub reports: Vec<Report>, pub now_ms: u64 }

#[derive(Default)]
struct Input { connected: bool, ps_held: bool, reports: VecDeque<Report>, rumble: Option<(Duration, f32, f32)> }

pub struct DualSense {
    input: Arc<Mutex<Input>>,
    running: Arc<AtomicBool>,
    epoch: Instant,
}

impl DualSense {
    pub fn start(app: tauri::AppHandle) -> Self {
        let input = Arc::new(Mutex::new(Input::default()));
        let running = Arc::new(AtomicBool::new(true));
        let epoch = Instant::now();
        #[cfg(windows)] {
            let shared = input.clone();
            let alive = running.clone();
            std::thread::spawn(move || read_controller(app, shared, alive, epoch));
        }
        #[cfg(not(windows))] let _ = app;
        Self { input, running, epoch }
    }

    pub fn poll(&self) -> Batch {
        let mut input = self.input.lock().unwrap_or_else(|error| error.into_inner());
        Batch { connected: input.connected, reports: input.reports.drain(..).collect(), now_ms: self.epoch.elapsed().as_millis() as u64 }
    }

    pub fn rumble(&self, duration: u64, weak: f32, strong: f32) -> bool {
        if !(1..=1000).contains(&duration) || !weak.is_finite() || !strong.is_finite()
            || !(0.0..=1.0).contains(&weak) || !(0.0..=1.0).contains(&strong) { return false; }
        let mut input = self.input.lock().unwrap_or_else(|error| error.into_inner());
        if !input.connected { return false; }
        input.rumble = Some((Duration::from_millis(duration), weak, strong));
        true
    }

    pub fn stop(&self) { self.running.store(false, Ordering::Release); }
    pub fn guide_held(&self) -> bool { self.input.lock().is_ok_and(|input| input.ps_held) }
}

impl Drop for DualSense { fn drop(&mut self) { self.stop(); } }

// HID read includes the report ID. Windows pads the basic Bluetooth report to
// 78 bytes; it has just nine payload bytes, unlike USB's 63-byte payload.
pub fn normalize(raw: &[u8], timestamp_ms: u64) -> Option<(Report, bool)> {
    let id = *raw.first()?;
    let length = match (id, raw.len()) {
        (0x31, 78) => 77,
        (1, 64) => 63,
        (1, 10 | 78) => 9,
        _ => return None,
    };
    let bytes = raw[1..=length].to_vec();
    let ps_index = if id == 0x31 { 10 } else if length == 9 { 6 } else { 9 };
    let ps = bytes[ps_index] & 1 != 0;
    Some((Report { report_id: id, bytes, timestamp_ms }, ps))
}

fn signature(report: &Report) -> Vec<u8> {
    if report.bytes.len() == 9 { return report.bytes.clone(); }
    let offset = usize::from(report.report_id == 0x31);
    [&report.bytes[offset..offset + 6], &report.bytes[offset + 7..offset + 10],
        &report.bytes[offset + 32..offset + 40]].concat()
}

fn rumble_report(bluetooth: bool, sequence: u8, weak: f32, strong: f32) -> Vec<u8> {
    let mut report = vec![0; if bluetooth { 78 } else { 48 }];
    report[0] = if bluetooth { 0x31 } else { 2 };
    let common = if bluetooth { report[1] = (sequence & 15) << 4; report[2] = 0x10; 3 } else { 1 };
    report[common] = 3;
    report[common + 2] = (weak * 255.0).round() as u8;
    report[common + 3] = (strong * 255.0).round() as u8;
    if bluetooth {
        let mut crc = 0xffff_ffffu32;
        for byte in std::iter::once(&0xa2).chain(report[..74].iter()) {
            crc ^= u32::from(*byte);
            for _ in 0..8 { crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb8_8320 } else { 0 }; }
        }
        report[74..].copy_from_slice(&(!crc).to_le_bytes());
    }
    report
}

#[cfg(windows)]
fn read_controller(app: tauri::AppHandle, input: Arc<Mutex<Input>>, running: Arc<AtomicBool>, epoch: Instant) {
    use hidapi::HidApi;
    while running.load(Ordering::Acquire) {
        let api = match HidApi::new() {
            Ok(api) => api,
            Err(error) => { log::warn!("DualSense HID enumeration failed: {error}"); std::thread::sleep(Duration::from_secs(1)); continue; }
        };
        let connection = api.device_list().filter(|info| info.vendor_id() == 0x054c
            && matches!(info.product_id(), 0x0ce6 | 0x0df2) && info.usage_page() == 1 && info.usage() == 5)
            .find_map(|info| {
                let device = info.open_device(&api).ok()?;
                // Bluetooth can remain silent in its basic mode until a button
                // moves. Request full reports before waiting for the first one.
                let mut feature = [0u8; 41]; feature[0] = 5;
                let full_requested = device.get_feature_report(&mut feature).is_ok();
                let mut first = [0u8; 128];
                let length = device.read_timeout(&mut first, 250).ok()?;
                let (report, ps) = normalize(&first[..length], epoch.elapsed().as_millis() as u64)?;
                Some((device, report, ps, full_requested))
            });
        let Some((device, initial, initial_ps, full_requested)) = connection else { std::thread::sleep(Duration::from_millis(1000)); continue; };
        let initial_bt = initial.report_id == 0x31 || initial.bytes.len() == 9;
        log::info!("DualSense connected through native HID: {}; report={:#x}, payload={}",
            if initial_bt { "Bluetooth" } else { "USB" }, initial.report_id, initial.bytes.len());
        let mut previous = signature(&initial);
        let mut previous_back = back_pressed(&initial);
        if let Ok(mut state) = input.lock() { state.connected = true; state.ps_held = initial_ps; state.reports.clear(); state.reports.push_back(initial); }
        let mut raw = [0u8; 128];
        let mut previous_ps = Some(initial_ps);
        let mut guide_press = None;
        let mut last_sent = Instant::now();
        let mut requested_full = full_requested;
        let mut bluetooth = Some(initial_bt);
        let mut sequence = 0u8;
        let mut rumble_until = None;
        while running.load(Ordering::Acquire) {
            let pending = input.lock().ok().and_then(|mut state| state.rumble.take());
            if let (Some((duration, weak, strong)), Some(bt)) = (pending, bluetooth) {
                let _ = device.write(&rumble_report(bt, sequence, weak, strong));
                sequence = sequence.wrapping_add(1);
                rumble_until = Some(Instant::now() + duration);
            }
            if rumble_until.is_some_and(|deadline| Instant::now() >= deadline) {
                if let Some(bt) = bluetooth { let _ = device.write(&rumble_report(bt, sequence, 0.0, 0.0)); sequence = sequence.wrapping_add(1); }
                rumble_until = None;
            }
            let length = match device.read_timeout(&mut raw, 20) {
                Ok(0) => continue,
                Ok(length) => length,
                Err(error) => { log::info!("DualSense disconnected: {error}"); break; }
            };
            let Some((report, ps)) = normalize(&raw[..length], epoch.elapsed().as_millis() as u64) else { continue; };
            if let Ok(mut state) = input.lock() { state.ps_held = ps; }
            let back = back_pressed(&report);
            if !back && previous_back { crate::note_overlay_exit_interaction(&app); }
            previous_back = back;
            bluetooth = Some(report.report_id == 0x31 || report.bytes.len() == 9);
            if report.bytes.len() == 9 && !requested_full {
                requested_full = true;
                let mut feature = [0u8; 41]; feature[0] = 5;
                if let Err(error) = device.get_feature_report(&mut feature) { log::warn!("DualSense full Bluetooth report request failed: {error}"); }
            }
            if ps && previous_ps == Some(false) {
                log::info!("DualSense PS button pressed through native HID");
                guide_press = crate::capture_native_guide(&app);
            }
            if !ps && previous_ps == Some(true) {
                if let Some(press) = guide_press.take() {
                    log::info!("DualSense PS button released; checking whether Steam already handled it");
                    crate::handle_native_guide_release(&app, press);
                }
            }
            previous_ps = Some(ps);
            let current = signature(&report);
            if current != previous || last_sent.elapsed() >= Duration::from_millis(500) {
                previous = current; last_sent = Instant::now();
                if let Ok(mut state) = input.lock() {
                    if state.reports.len() >= 128 { state.reports.pop_front(); }
                    state.reports.push_back(report);
                }
            }
        }
        if let Some(bt) = bluetooth { let _ = device.write(&rumble_report(bt, sequence, 0.0, 0.0)); }
        if let Ok(mut state) = input.lock() { state.connected = false; state.ps_held = false; state.reports.clear(); state.rumble = None; }
    }
}

fn back_pressed(report: &Report) -> bool {
    let face = if report.bytes.len() == 9 { 4 } else { 7 + usize::from(report.report_id == 0x31) };
    report.bytes[face] & 0x40 != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn usb_and_bluetooth_ps_offsets_are_not_confused() {
        let mut usb = vec![0; 64]; usb[0] = 1; usb[10] = 1;
        let (report, ps) = normalize(&usb, 123).unwrap();
        assert!(ps); assert_eq!(report.bytes.len(), 63); assert_eq!(report.timestamp_ms, 123);
        let mut bt = vec![0; 78]; bt[0] = 0x31; bt[11] = 1;
        assert!(normalize(&bt, 0).unwrap().1);
        bt[11] = 0; bt[10] = 1; assert!(!normalize(&bt, 0).unwrap().1);
        let mut basic = vec![0; 78]; basic[0] = 1; basic[7] = 1;
        let (report, ps) = normalize(&basic, 0).unwrap(); assert!(ps); assert_eq!(report.bytes.len(), 9);
        assert!(normalize(&[0x31; 12], 0).is_none());
    }
    #[test]
    fn dedup_keeps_both_finger_contacts_and_ignores_gyro_noise() {
        let mut raw = vec![0; 64]; raw[0] = 1;
        let before = signature(&normalize(&raw, 0).unwrap().0);
        raw[18] = 12; assert_eq!(before, signature(&normalize(&raw, 0).unwrap().0));
        raw[39] = 20; assert_ne!(before, signature(&normalize(&raw, 0).unwrap().0));
    }
}
