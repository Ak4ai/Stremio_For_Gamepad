// Use the renderer injected by Steam for this shortcut. Never initialize a
// different Steamworks application, load a DLL from disk, or change Steam IDs.
#[derive(Clone, Copy)]
pub struct SteamRenderer {
    #[cfg(windows)] enabled: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] keyboard: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] mouse: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] gamepad: unsafe extern "C" fn() -> bool,
    #[cfg(windows)] needs_present: unsafe extern "C" fn() -> bool,
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
                needs_present: query(b"BOverlayNeedsPresent\0")?,
            });
        }
        #[cfg(not(windows))] { None }
    }

    pub fn enabled(&self) -> bool {
        #[cfg(windows)] unsafe { (self.enabled)() }
        #[cfg(not(windows))] { false }
    }

    pub fn input_active(&self) -> bool {
        #[cfg(windows)] unsafe { (self.keyboard)() || (self.mouse)() || (self.gamepad)() }
        #[cfg(not(windows))] { false }
    }

    pub fn needs_present(&self) -> bool {
        #[cfg(windows)] unsafe { (self.needs_present)() }
        #[cfg(not(windows))] { false }
    }

    pub fn active(&self) -> bool { self.input_active() }

}

pub fn app_is_foreground() -> bool {
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        let mut pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
        pid == std::process::id()
    }
    #[cfg(not(windows))] { false }
}

pub fn forward_native_shortcut_to(renderer: SteamRenderer, desired: bool, target: usize, observed: impl Fn() -> bool) -> bool {
    log::info!("Native shortcut requested: target={desired}; input={}; foreground={:#x}; app_foreground={}",
        renderer.input_active(), foreground_handle(), app_is_foreground());
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
        // Let the original physical key press finish before forwarding it to
        // the native surface. The webview and Steam must not toggle twice.
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        while ((GetAsyncKeyState(VK_TAB as i32) as u16 | GetAsyncKeyState(VK_SHIFT as i32) as u16) & 0x8000) != 0
            && std::time::Instant::now() < deadline {
            if renderer.active() == desired { return true; }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        // Allow the final physical key-up and Steam's next input frame to run.
        std::thread::sleep(std::time::Duration::from_millis(40));
        if renderer.active() == desired { log::info!("Native shortcut skipped: input already matches target"); return true; }
        if !app_is_foreground() { log::warn!("Native shortcut skipped: foreground changed to {:#x}", foreground_handle()); return false; }
        // Steam also polls key state between frames. Sending down/up in one
        // batch makes the shortcut disappear before its next input sample.
        // Use the native key-state path, including when Steam intercepts the
        // game's SendInput calls. Activation is confirmed separately below.
        return send_via_input_helper(target, &observed);
    }
    #[cfg(not(windows))] { false }
}


pub fn close_chord_down() -> bool {
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
        (GetAsyncKeyState(VK_SHIFT as i32) as u16 & 0x8000) != 0 && (GetAsyncKeyState(VK_TAB as i32) as u16 & 0x8000) != 0
    }
    #[cfg(not(windows))] { false }
}

pub fn key_down(key: i32) -> bool {
    #[cfg(windows)] unsafe { (windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(key) as u16 & 0x8000) != 0 }
    #[cfg(not(windows))] { let _ = key; false }
}

pub fn foreground_handle() -> usize {
    #[cfg(windows)] unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as usize }
    #[cfg(not(windows))] { 0 }
}

struct InputHelper {
    process_id: u32,
    input: std::net::TcpStream,
    output: std::io::BufReader<std::net::TcpStream>,
}
static INPUT_HELPER: std::sync::OnceLock<std::sync::Mutex<Option<InputHelper>>> = std::sync::OnceLock::new();

fn send_via_input_helper(target: usize, observed: &impl Fn() -> bool) -> bool {
    use std::io::{BufRead, Write};
    let mut helper = INPUT_HELPER.get_or_init(|| std::sync::Mutex::new(None)).lock().unwrap_or_else(|error| error.into_inner());
    if helper.is_none() {
        let result = (|| -> std::io::Result<InputHelper> {
            let shell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:/Windows".into()))
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
            use base64::Engine;
            let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
            listener.set_nonblocking(true)?;
            let mut random = [0u8; 32];
            getrandom::fill(&mut random).map_err(|error| std::io::Error::other(error.to_string()))?;
            let token: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let script = include_str!("steam-key-helper.ps1")
                .replace("__PARENT_PID__", &std::process::id().to_string())
                .replace("__PORT__", &listener.local_addr()?.port().to_string())
                .replace("__TOKEN__", &token);
            let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
            // Execute through the existing desktop shell: a descendant of the
            // Steam process gets input interception injected into it as well.
            // The desktop helper uses the caller's interactive session/token.
            let shell_path = shell.to_string_lossy().replace("'", "''");
            let launch = format!("$ErrorActionPreference='Stop'; $shell=New-Object -ComObject Shell.Application; [int]$h=0; $desktop=$shell.Windows().FindWindowSW(0,0,8,[ref]$h,1); if (-not $desktop) {{ throw 'Desktop shell unavailable' }}; $desktop.Document.Application.ShellExecute('{shell_path}','-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {encoded}','','open',0)");
            let mut command = std::process::Command::new(&shell);
            command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &launch])
                .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            if !command.status()?.success() { return Err(std::io::Error::other("desktop helper launch failed")); }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        stream.set_nonblocking(false)?;
                        stream.set_read_timeout(Some(std::time::Duration::from_secs(2)))?;
                        stream.set_write_timeout(Some(std::time::Duration::from_secs(2)))?;
                        let mut output = std::io::BufReader::new(stream.try_clone()?);
                        let mut ready = String::new(); output.read_line(&mut ready)?;
                        let parts: Vec<&str> = ready.split_whitespace().collect();
                        if parts.len() == 4 && parts[0] == "ready" && parts[1] == token && parts[3] == "False" {
                            let process_id = parts[2].parse::<u32>().map_err(std::io::Error::other)?;
                            log::info!("External input helper authenticated: pid={process_id}; Steam injection absent");
                            return Ok(InputHelper { process_id, input: stream, output });
                        }
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(error) => return Err(error),
                }
                if std::time::Instant::now() >= deadline { return Err(std::io::Error::other("external input helper connection timeout")); }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        })();
        match result { Ok(created) => *helper = Some(created), Err(error) => { log::warn!("Input helper failed: {error}"); return false; } }
    }
    let current = helper.as_mut().unwrap();
    #[cfg(windows)] unsafe { windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(current.process_id); }
    let mut response = String::new();
    let focus_message = format!("focus {target:x}\n");
    let focused = current.input.write_all(focus_message.as_bytes()).and_then(|_| current.input.flush())
        .and_then(|_| current.output.read_line(&mut response).map(|_| ()));
    if focused.is_err() || !response.starts_with("focused ") { return false; }
    // The original physical hotkey may finish while the helper starts or
    // restores focus. Recheck its acknowledgement before replaying a toggle.
    std::thread::sleep(std::time::Duration::from_millis(120));
    if observed() { log::info!("Original shortcut acknowledged before relay; duplicate toggle suppressed"); return true; }
    response.clear();
    let message = format!("toggle {target:x}\n");
    let result = current.input.write_all(message.as_bytes()).and_then(|_| current.input.flush())
        .and_then(|_| current.output.read_line(&mut response).map(|_| ()));
    if let Err(error) = result {
        log::warn!("Input helper communication failed: {error}");
        if let Some(current) = helper.take() { let _ = current.input.shutdown(std::net::Shutdown::Both); }
        return false;
    }
    log::info!("Input helper result: {}", response.trim());
    response.trim().starts_with("sent ")
}

pub fn stop_input_helper() {
    if let Some(slot) = INPUT_HELPER.get() {
        if let Ok(mut helper) = slot.lock() {
            if let Some(current) = helper.take() { let _ = current.input.shutdown(std::net::Shutdown::Both); }
        }
    }
}
