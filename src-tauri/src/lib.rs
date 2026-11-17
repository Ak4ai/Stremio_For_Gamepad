use std::process::{Command, Stdio};
use std::path::PathBuf;
mod steam_launch;
mod steam_renderer;
mod dualsense;
mod local_addons;

struct StreamingEngine(Option<std::process::Child>);

impl StreamingEngine {
  fn stop(&mut self) {
    if let Some(mut child) = self.0.take() {
      // Steam tracks child processes: an orphaned engine keeps the shortcut
      // marked as running and prevents the next launch. Own only our child;
      // an already-running engine belongs to its original application.
      let _ = child.kill();
      let _ = child.wait();
    }
  }
}

impl Drop for StreamingEngine {
  fn drop(&mut self) { self.stop(); }
}

/// Folder with the bundled Stremio server, its Node runtime and ffmpeg.
pub(crate) fn find_server_dir() -> Option<PathBuf> {
  let exe_path = std::env::current_exe().unwrap_or_default();
  let base_dir = exe_path.parent().unwrap_or(std::path::Path::new(""));

  let candidates = [
    base_dir.join("bin").join("server"),
    base_dir.join("resources").join("bin").join("server"),
    base_dir.join("_up_").join("bin").join("server"),
    base_dir.join("..").join("bin").join("server"),
    PathBuf::from("bin/server"),
    PathBuf::from("../bin/server"),
  ];

  candidates.into_iter().find(|p| p.join("server.js").exists())
}

fn ensure_stremio_server() -> StreamingEngine {
  // Check if Stremio streaming engine is already active on port 11470
  if std::net::TcpStream::connect("127.0.0.1:11470").is_ok() {
    return StreamingEngine(None);
  }

  if let Some(dir) = find_server_dir() {
    let runtime = if dir.join("stremio-runtime.exe").exists() {
      dir.join("stremio-runtime.exe")
    } else {
      PathBuf::from("node")
    };

    let server_script = dir.join("server.js");
    let ffmpeg = dir.join("ffmpeg.exe");
    let ffprobe = dir.join("ffprobe.exe");

    let mut cmd = Command::new(runtime);
    cmd.arg(server_script)
      .current_dir(&dir)
      .env("FFMPEG_BIN", ffmpeg)
      .env("FFPROBE_BIN", ffprobe)
      .stdout(Stdio::null())
      .stderr(Stdio::null());

    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    return StreamingEngine(cmd.spawn().ok());
  }
  StreamingEngine(None)
}

#[tauri::command]
fn set_fullscreen(window: tauri::Window, fullscreen: bool) {
  let _ = window.set_fullscreen(fullscreen);
}

#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> bool {
  window.is_fullscreen().unwrap_or(false)
}

#[tauri::command]
fn minimize_app(window: tauri::Window) {
  let _ = window.minimize();
}

#[tauri::command]
fn close_app(window: tauri::Window) {
  let _ = window.close();
}

use tauri::Manager;

struct SteamState {
  renderer: Option<steam_renderer::SteamRenderer>,
  overlay_gate: std::sync::Arc<std::sync::Mutex<steam_launch::OverlayGate>>,
  request_busy: std::sync::Arc<std::sync::atomic::AtomicBool>,
  session: std::sync::Arc<std::sync::Mutex<steam_launch::OverlaySession>>,
}

#[tauri::command]
fn is_steam_running(state: tauri::State<'_, SteamState>) -> bool {
  state.renderer.is_some()
}

#[tauri::command]
async fn activate_steam_overlay(app: tauri::AppHandle, toggle: Option<bool>) -> bool {
  let open = app.state::<SteamState>().session.lock().is_ok_and(|session| session.presenting);
  request_steam_overlay(&app, if toggle.unwrap_or(false) { !open } else { true }).await
}


struct OverlayRequest(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for OverlayRequest {
  fn drop(&mut self) { self.0.store(false, std::sync::atomic::Ordering::Release); }
}

async fn request_steam_overlay(app: &tauri::AppHandle, desired: bool) -> bool {
  let (renderer, gate, busy, session) = {
    let state = app.state::<SteamState>();
    (state.renderer, state.overlay_gate.clone(), state.request_busy.clone(), state.session.clone())
  };
  let Some(renderer) = renderer else { return false; };
  if session.lock().is_ok_and(|state| state.presenting == desired) { return true; }
  if !steam_renderer::app_is_foreground() { return false; }
  if busy.compare_exchange(false, true, std::sync::atomic::Ordering::AcqRel, std::sync::atomic::Ordering::Acquire).is_err() {
    return true;
  }
  let app = app.clone();
  let guard = OverlayRequest(busy);
  tauri::async_runtime::spawn_blocking(move || {
    let _guard = guard;
    if !gate.lock().is_ok_and(|mut state| state.begin(std::time::Instant::now())) { return true; }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while !tauri_plugin_steam_overlay_surface::surface_active() && std::time::Instant::now() < deadline {
      std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if !tauri_plugin_steam_overlay_surface::surface_active() { return false; }
    if !steam_renderer::app_is_foreground() { return false; }
    log::info!("Steam presentation request: {desired}; foreground HWND={:#x}", steam_renderer::foreground_handle());
    if !desired {
      // The physical shortcut is already delivered to Steam. Do not replay a
      // close toggle, which would reopen a panel Steam has just dismissed.
      return finish_overlay_close(&app, renderer);
    }
    if let Ok(mut state) = session.lock() { state.open(); }
    set_frontend_overlay_state(&app, true);
    tauri_plugin_steam_overlay_surface::on_overlay_activated(&app, true);
    let ready = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while !renderer.enabled() && std::time::Instant::now() < ready {
      std::thread::sleep(std::time::Duration::from_millis(30));
    }
    if renderer.input_active() {
      if let Ok(mut state) = session.lock() { state.observe_input(true); }
    } else {
      steam_renderer::forward_native_shortcut_to(renderer, true, window_handle(&app, tauri_plugin_steam_overlay_surface::OVERLAY_LABEL), || session.lock().is_ok_and(|state| state.confirmed));
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
      if session.lock().is_ok_and(|state| state.confirmed) { return true; }
      std::thread::sleep(std::time::Duration::from_millis(30));
    }
    // A blind retry is a toggle and can close an overlay that is still opening.
    if desired {
      close_overlay_presentation(&app);
    }
    log::warn!("Steam overlay did not reach requested state: {desired}");
    false
  }).await.unwrap_or(false)
}

pub(crate) struct GuidePress { pressed: std::time::Instant, was_active: bool }

pub(crate) fn capture_native_guide(app: &tauri::AppHandle) -> Option<GuidePress> {
  if !steam_renderer::app_is_foreground() {
    log::info!("PS button ignored by application: another window has foreground focus");
    return None;
  }
  let renderer = {
    let state = app.state::<SteamState>();
    state.renderer
  };
  let renderer = renderer?;
  let _ = renderer;
  let shown = app.state::<SteamState>().session.lock().is_ok_and(|state| state.presenting);
  Some(GuidePress { was_active: shown, pressed: std::time::Instant::now() })
}

pub(crate) fn handle_native_guide_release(app: &tauri::AppHandle, press: GuidePress) {
  let (renderer, gate) = {
    let state = app.state::<SteamState>();
    (state.renderer, state.overlay_gate.clone())
  };
  let Some(renderer) = renderer else { return; };
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(200))).await;
    if press.was_active {
      // Steam receives PS directly while its native input window is focused.
      // Returning the app's presentation is not another Steam toggle.
      queue_overlay_close(&app);
      return;
    }
    let shown = app.state::<SteamState>().session.lock().is_ok_and(|state| state.presenting);
    if shown || gate.lock().is_ok_and(|state| state.guide_was_handled(press.pressed)) {
      log::info!("PS opening already handled; duplicate fallback skipped");
      return;
    }
    let _ = renderer;
    let _ = request_steam_overlay(&app, true).await;
  });
}

#[tauri::command]
fn dualsense_poll(state: tauri::State<'_, dualsense::DualSense>) -> dualsense::Batch { state.poll() }

#[tauri::command]
fn dualsense_rumble(state: tauri::State<'_, dualsense::DualSense>, duration: u64, weak: f32, strong: f32) -> bool {
  state.rumble(duration, weak, strong)
}

fn queue_overlay_close(app: &tauri::AppHandle) {
  let renderer = {
    let state = app.state::<SteamState>();
    let Ok(mut session) = state.session.lock() else { return; };
    if !session.presenting || session.closing { return; }
    session.closing = true;
    state.renderer
  };
  if let Some(renderer) = renderer {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || { finish_overlay_close(&app, renderer); });
  }
}

fn finish_overlay_close(app: &tauri::AppHandle, renderer: steam_renderer::SteamRenderer) -> bool {
  set_frontend_returning_state(app, true);
  // Let the WebView paint the indicator before revealing it. Cloaking leaves
  // the native window focused and presenting until Steam releases input.
  std::thread::sleep(std::time::Duration::from_millis(80));
  tauri_plugin_steam_overlay_surface::set_returning_to_app(app, true);
  // Keep presenting and keep native keyboard focus while Steam consumes the
  // physical close shortcut. Premature focus restoration cancels its toggle.
  let natural = std::time::Instant::now() + std::time::Duration::from_millis(500);
  // PS can briefly release capture before Steam processes its toggle. Wait
  // through the whole grace period, rather than taking that transient false
  // as a final close and missing the subsequent true state.
  while std::time::Instant::now() < natural {
    std::thread::sleep(std::time::Duration::from_millis(20));
  }
  let mut deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
  let mut idle_since = None;
  let mut relayed = false;
  while std::time::Instant::now() < deadline {
    if renderer.input_active() {
      idle_since = None;
      if !relayed && steam_renderer::app_is_foreground() {
        relayed = true;
        steam_renderer::forward_native_shortcut_to(renderer, false, window_handle(app, tauri_plugin_steam_overlay_surface::OVERLAY_LABEL), || !renderer.input_active());
        deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
      }
    } else {
      let since = idle_since.get_or_insert_with(std::time::Instant::now);
      if since.elapsed() >= std::time::Duration::from_millis(250) {
        close_overlay_presentation(app); return true;
      }
    }
    std::thread::sleep(std::time::Duration::from_millis(20));
  }
  if let Ok(mut session) = app.state::<SteamState>().session.lock() { session.closing = false; }
  set_frontend_returning_state(app, false);
  tauri_plugin_steam_overlay_surface::set_returning_to_app(app, false);
  log::warn!("Steam close not confirmed; retaining native presentation instead of hiding an active panel");
  false
}

fn close_overlay_presentation(app: &tauri::AppHandle) {
  {
    let state = app.state::<SteamState>();
    if let Ok(mut session) = state.session.lock() { session.close(); }
  }
  tauri_plugin_steam_overlay_surface::on_overlay_activated(app, false);
  set_frontend_overlay_state(app, false);
  // Focus the browser child once after an explicit close, never on generic
  // foreground events; window focus alone leaves WebView2 keyboard-deaf.
  if steam_renderer::app_is_foreground() {
    if let Some(webview) = app.get_webview("main") { let _ = webview.set_focus(); }
  }
  log::info!("Steam presentation explicitly closed; WebView input restored");
  set_frontend_returning_state(app, false);
}

pub(crate) fn note_overlay_exit_interaction(app: &tauri::AppHandle) {
  let state = app.state::<SteamState>();
  if let Ok(mut session) = state.session.lock() { if session.presenting { session.exit_interaction(); } }
}

fn window_handle(app: &tauri::AppHandle, label: &str) -> usize {
  #[cfg(windows)] { app.get_window(label).and_then(|window| window.hwnd().ok()).map(|hwnd| hwnd.0 as usize).unwrap_or(0) }
  #[cfg(not(windows))] { let _ = (app, label); 0 }
}

fn set_frontend_overlay_state(app: &tauri::AppHandle, active: bool) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('steam-overlay-state', {{ detail: {active} }}))"));
  }
}

fn set_frontend_returning_state(app: &tauri::AppHandle, active: bool) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('steam-overlay-returning', {{ detail: {active} }}))"));
  }
}

#[tauri::command]
fn open_in_browser(url: String) {
  // Addons can hand us links: only web pages, and never through a shell.
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return;
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("rundll32")
      .args(["url.dll,FileProtocolHandler", &url])
      .creation_flags(0x08000000)
      .spawn();
  }
  #[cfg(not(windows))]
  {
    let _ = Command::new("xdg-open").arg(&url).spawn();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(windows)]
  {
    let existing_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    let custom_args = "--disable-hid-blocklist --enable-gamepad-button-axis-events";
    let combined = if existing_args.is_empty() {
      custom_args.to_string()
    } else {
      format!("{existing_args} {custom_args}")
    };
    unsafe {
      std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
    }
  }

  let renderer = steam_renderer::SteamRenderer::injected();
  let streaming_engine = std::sync::Mutex::new(ensure_stremio_server());
  let overlay_gate = std::sync::Arc::new(std::sync::Mutex::new(steam_launch::OverlayGate::default()));

  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .level_for("wgpu_hal", log::LevelFilter::Warn)
      .level_for("wgpu_core", log::LevelFilter::Warn)
      .build());
  // Outside Steam there is no injected renderer to hook the native surface.
  // Avoid allocating another GPU device and window on ordinary launches.
  if renderer.is_some() {
    builder = builder.plugin(tauri_plugin_steam_overlay_surface::Builder::new()
      .overlay_title("Steam for Consoles Overlay")
      .snapshot_backdrop(true)
      .build());
  }
  builder.invoke_handler(tauri::generate_handler![
      set_fullscreen,
      is_fullscreen,
      minimize_app,
      close_app,
      open_in_browser,
      is_steam_running,
      activate_steam_overlay,
      dualsense_poll,
      dualsense_rumble,
      local_addons::local_addons_list,
      local_addons::local_addons_install,
      local_addons::local_addons_set_enabled,
      local_addons::local_addons_remove,
      local_addons::local_addons_log,
      local_addons::local_addons_browse
    ])
    .setup(move |app| {
      let addons_root = app.path().app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("com.stremio.gamepad"))
        .join("addons");
      let local_addons = local_addons::LocalAddons::load(addons_root);
      local_addons.start_enabled();
      app.manage(local_addons);
      app.manage(SteamState { renderer, overlay_gate: overlay_gate.clone(), request_busy: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)), session: std::sync::Arc::new(std::sync::Mutex::new(steam_launch::OverlaySession::default())) });
      app.manage(dualsense::DualSense::start(app.handle().clone()));
      log::info!("Steam renderer injected: {}; SteamAppId={:?}; SteamGameId={:?}; no SDK AppId override",
        renderer.is_some(), std::env::var("SteamAppId").ok(), std::env::var("SteamGameId").ok());

      if let Some(renderer) = renderer {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          let mut previous_input = false;
          let mut previous_chord = false;
          let mut close_chord = false;
          let mut previous_escape = false;
          let mut previous_mouse = false;
          let mut mouse_in_panel = false;
          let mut pending_native_open = false;
          while handle.get_window("main").is_some() {
            let state = handle.state::<SteamState>();
            let input = renderer.input_active();
            let busy = state.request_busy.load(std::sync::atomic::Ordering::Acquire);
            let foreground = steam_renderer::foreground_handle();
            let main_hwnd = window_handle(&handle, "main");
            let surface_hwnd = window_handle(&handle, tauri_plugin_steam_overlay_surface::OVERLAY_LABEL);
            let shown = state.session.lock().is_ok_and(|session| session.presenting);
            let chord = steam_renderer::close_chord_down();
            if chord && !previous_chord { close_chord = shown && !busy && steam_renderer::app_is_foreground(); }
            if !chord && previous_chord && close_chord && !busy {
              close_chord = false;
              queue_overlay_close(&handle);
            }
            previous_chord = chord;
            let escape = steam_renderer::key_down(0x1b);
            let mouse = steam_renderer::key_down(1);
            if mouse && !previous_mouse { mouse_in_panel = shown && foreground == surface_hwnd; }
            if (!mouse && previous_mouse && mouse_in_panel) || (!escape && previous_escape && shown) {
              note_overlay_exit_interaction(&handle);
            }
            previous_escape = escape; previous_mouse = mouse;
            if let Ok(mut session) = state.session.lock() { session.observe_input(input); }
            if input != previous_input {
              log::info!("Steam input capture={input}; needs_present={}; shown={shown}; fg={foreground:#x}; main={main_hwnd:#x}; surface={surface_hwnd:#x}", renderer.needs_present());
              if let Ok(mut gate) = overlay_gate.lock() { gate.set_active(input, std::time::Instant::now()); }
              if input && !shown && !busy && steam_renderer::app_is_foreground() && state.session.lock().is_ok_and(|session| session.can_adopt()) {
                pending_native_open = true;
              }
              previous_input = input;
            }
            let held = handle.state::<dualsense::DualSense>().guide_held();
            if pending_native_open && !held && !busy {
              if let Ok(mut session) = state.session.lock() { session.open(); session.observe_input(true); }
              set_frontend_overlay_state(&handle, true);
              tauri_plugin_steam_overlay_surface::on_overlay_activated(&handle, true);
              pending_native_open = false;
            }
            // Close icons / Escape / controller Back can return native focus
            // to the main window. Input loss alone must never hide the panel.
            if shown && !busy && !input && steam_renderer::app_is_foreground()
              && state.session.lock().is_ok_and(|session| session.exit_acknowledged()) {
              queue_overlay_close(&handle);
            } else if shown && !busy && foreground == main_hwnd && !input {
              if state.session.lock().is_ok_and(|session| session.has_exit_hint()) {
                queue_overlay_close(&handle);
              } else if let Some(surface) = handle.get_window(tauri_plugin_steam_overlay_surface::OVERLAY_LABEL) {
                let _ = surface.set_focus();
              }
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
          }
        });
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |app, event| {
      // Tauri can terminate the process without unwinding local destructors.
      // Stop the owned engine explicitly before runtime exit.
      if matches!(event, tauri::RunEvent::Exit) {
        steam_renderer::stop_input_helper();
        if let Some(input) = app.try_state::<dualsense::DualSense>() { input.stop(); }
        if let Some(addons) = app.try_state::<local_addons::LocalAddons>() { addons.stop_all(); }
        if let Ok(mut engine) = streaming_engine.lock() { engine.stop(); }
      }
    });
}
