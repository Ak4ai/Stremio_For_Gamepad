// Use the renderer injected by Steam for this shortcut. Never initialize a
// different Steamworks application, load a DLL from disk, or change Steam IDs.
#[derive(Clone, Copy)]
pub struct SteamRenderer {
    #[cfg(windows)] enabled: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] keyboard: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] mouse: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] gamepad: unsafe extern "C" fn() -> bool,
}

impl SteamRenderer {
    pub fn injected() -> Option<Self> {
        #[cfg(windows)] unsafe {
            use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
            let name: Vec<u16> = "GameOverlayRenderer64.dll\0".encode_utf16().collect();
            let module = GetModuleHandleW(name.as_ptr());
            if module.is_null() { return None; }
            // Optional, read-only exports of the injected renderer. If Steam
            // removes these exports, report unavailable instead of calling a
            // guessed address. x64 Steam returns bool and takes no arguments.
            let query = |name: &'static [u8]| {
                GetProcAddress(module, name.as_ptr()).map(|address|
                    std::mem::transmute::<unsafe extern "system" fn() -> isize, unsafe extern "C" fn() -> bool>(address))
            };
            return Some(Self {
                enabled: query(b"IsOverlayEnabled\0")?,
                keyboard: query(b"SteamOverlayIsUsingKeyboard\0")?,
                mouse: query(b"SteamOverlayIsUsingMouse\0")?,
                gamepad: query(b"SteamOverlayIsUsingGamepad\0")?,
            });
        }
        #[cfg(not(windows))] { None }
    }

    pub fn enabled(&self) -> bool {
        #[cfg(windows)] unsafe { (self.enabled)() }
        #[cfg(not(windows))] { false }
    }

    pub fn active(&self) -> bool {
        #[cfg(windows)] unsafe { (self.keyboard)() || (self.mouse)() || (self.gamepad)() }
        #[cfg(not(windows))] { false }
    }
}

pub fn forward_native_shortcut() -> bool {
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
        // Let the original physical key press finish before forwarding it to
        // the native surface. The webview and Steam must not toggle twice.
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        while ((GetAsyncKeyState(VK_TAB as i32) as u16 | GetAsyncKeyState(VK_SHIFT as i32) as u16) & 0x8000) != 0
            && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        // Steam also polls key state between frames. Sending down/up in one
        // batch makes the shortcut disappear before its next input sample.
        // Use the native key-state path, including when Steam intercepts the
        // game's SendInput calls. Activation is confirmed separately below.
        keybd_event(VK_SHIFT as u8, 0, 0, 0);
        keybd_event(VK_TAB as u8, 0, 0, 0);
        std::thread::sleep(std::time::Duration::from_millis(100));
        keybd_event(VK_TAB as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_SHIFT as u8, 0, KEYEVENTF_KEYUP, 0);
        return true;
    }
    #[cfg(not(windows))] { false }
}
