// Background polling of XInput Guide / PS button (ordinal 100 of xinput DLLs)
// to activate the Steam overlay whenever the Guide button is pressed on any controller.

#[cfg(windows)]
pub fn start_guide_watcher(app_handle: tauri::AppHandle) {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct XInputGamepadEx {
        w_buttons: u16,
        b_left_trigger: u8,
        b_right_trigger: u8,
        s_thumb_lx: i16,
        s_thumb_ly: i16,
        s_thumb_rx: i16,
        s_thumb_ry: i16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct XInputStateEx {
        dw_packet_number: u32,
        gamepad: XInputGamepadEx,
    }

    type XInputGetStateExFn = unsafe extern "system" fn(u32, *mut XInputStateEx) -> u32;

    const XINPUT_GAMEPAD_GUIDE: u16 = 0x0400;

    std::thread::spawn(move || {
        let dlls: [&[u16]; 2] = [
            &[b'x' as u16, b'i' as u16, b'n' as u16, b'p' as u16, b'u' as u16, b't' as u16, b'1' as u16, b'_' as u16, b'4' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0],
            &[b'x' as u16, b'i' as u16, b'n' as u16, b'p' as u16, b'u' as u16, b't' as u16, b'1' as u16, b'_' as u16, b'3' as u16, b'.' as u16, b'd' as u16, b'l' as u16, b'l' as u16, 0],
        ];

        let mut get_state_ex: Option<XInputGetStateExFn> = None;
        for dll_name in dlls {
            let h = unsafe { LoadLibraryW(dll_name.as_ptr()) };
            if !h.is_null() {
                let proc = unsafe { GetProcAddress(h, 100 as *const u8) };
                if let Some(proc) = proc {
                    get_state_ex = Some(unsafe { std::mem::transmute(proc) });
                    log::info!("XInputGetStateEx (ordinal 100) loaded successfully");
                    break;
                }
            }
        }

        let Some(get_state_ex) = get_state_ex else {
            log::warn!("XInputGetStateEx not found; guide button polling disabled in backend");
            return;
        };

        let mut prev_pressed = false;
        let mut last_trigger = std::time::Instant::now();

        loop {
            std::thread::sleep(std::time::Duration::from_millis(25));

            let mut guide_pressed = false;
            let mut state: XInputStateEx = unsafe { std::mem::zeroed() };

            for user_index in 0..4 {
                let res = unsafe { get_state_ex(user_index, &mut state) };
                if res == 0 && (state.gamepad.w_buttons & XINPUT_GAMEPAD_GUIDE) != 0 {
                    guide_pressed = true;
                    break;
                }
            }

            if guide_pressed && !prev_pressed {
                let now = std::time::Instant::now();
                if now.duration_since(last_trigger) > std::time::Duration::from_millis(1500) {
                    last_trigger = now;
                    log::info!("Guide / PS button pressed on controller; triggering Steam overlay");
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::activate_steam_overlay_internal(&handle).await;
                    });
                }
            }
            prev_pressed = guide_pressed;
        }
    });
}

#[cfg(not(windows))]
pub fn start_guide_watcher(_app_handle: tauri::AppHandle) {}
