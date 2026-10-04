use std::process::{Command, Stdio};
use std::path::PathBuf;
mod steam_launch;
mod steam_renderer;

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

fn ensure_stremio_server() -> StreamingEngine {
  // Check if Stremio streaming engine is already active on port 11470
  if std::net::TcpStream::connect("127.0.0.1:11470").is_ok() {
    return StreamingEngine(None);
  }

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

  if let Some(dir) = candidates.into_iter().find(|p| p.join("server.js").exists()) {
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
}

#[tauri::command]
fn is_steam_running(state: tauri::State<'_, SteamState>) -> bool {
  state.renderer.is_some()
}

#[tauri::command]
async fn activate_steam_overlay(app: tauri::AppHandle) -> bool {
  let (renderer, overlay_gate) = {
    let state = app.state::<SteamState>();
    (state.renderer, state.overlay_gate.clone())
  };
  let Some(renderer) = renderer else { return false; };
  tauri::async_runtime::spawn_blocking(move || {
    log::info!("Steam overlay requested from interface");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while !tauri_plugin_steam_overlay_surface::surface_active() && std::time::Instant::now() < deadline {
      std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if !tauri_plugin_steam_overlay_surface::surface_active() {
      log::warn!("Steam overlay surface is not ready");
      return false;
    }
    let Ok(mut gate) = overlay_gate.lock() else { return false; };
    let bootstrap = gate.needs_bootstrap();
    if !gate.request_open(std::time::Instant::now()) {
      log::info!("Steam overlay duplicate request ignored");
      return true;
    }
    drop(gate);
    // The native surface paints a captured application frame behind Steam.
    // The underlying webview keeps rendering and playing video normally.
    set_frontend_overlay_state(&app, true);
    tauri_plugin_steam_overlay_surface::on_overlay_activated(&app, true);
    // Showing the snapshot and handing focus to the raw native window must
    // finish before Steam sees the hotkey, even when its renderer is warm.
    std::thread::sleep(std::time::Duration::from_millis(250));
    let ready_deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while !renderer.enabled() && std::time::Instant::now() < ready_deadline {
      std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // The injected renderer's readiness export can stay false for shortcuts
    // before the first native hotkey. It is diagnostic, not an SDK gate.
    let initially_ready = renderer.enabled();
    log::info!("Steam renderer readiness before native shortcut: {initially_ready}");
    let forwarded = renderer.active() || steam_renderer::forward_native_shortcut();
    log::info!("Steam native shortcut forwarded: {forwarded}");
    if forwarded {
      let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
      // Readiness means a graphics hook exists, not that Steam's UI process
      // finished its first load. Keep the cold-start retry separate.
      let retry_after = std::time::Instant::now() + std::time::Duration::from_millis(if bootstrap { 2000 } else { 800 });
      let mut retried_after_ready = false;
      while std::time::Instant::now() < deadline {
        if renderer.active() { return true; }
        if !retried_after_ready && std::time::Instant::now() >= retry_after && renderer.enabled() {
          retried_after_ready = true;
          log::info!("Steam activation not yet confirmed; forwarding shortcut once after readiness");
          steam_renderer::forward_native_shortcut();
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
      }
    }
    tauri_plugin_steam_overlay_surface::on_overlay_activated(&app, false);
    set_frontend_overlay_state(&app, false);
    log::warn!("Steam did not activate its native overlay");
    false
  }).await.unwrap_or(false)
}

fn set_frontend_overlay_state(app: &tauri::AppHandle, active: bool) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('steam-overlay-state', {{ detail: {active} }}))"));
  }
}

#[tauri::command]
fn open_in_browser(url: String) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("cmd")
      .args(["/c", "start", "", &url])
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
      activate_steam_overlay
    ])
    .setup(move |app| {
      app.manage(SteamState { renderer, overlay_gate: overlay_gate.clone() });
      log::info!("Steam renderer injected: {}; SteamAppId={:?}; SteamGameId={:?}; no SDK AppId override",
        renderer.is_some(), std::env::var("SteamAppId").ok(), std::env::var("SteamGameId").ok());
      if let Some(renderer) = renderer {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          let mut previous = false;
          while handle.get_window("main").is_some() {
            let active = renderer.active();
            if active != previous {
              previous = active;
              log::info!("Steam native overlay active: {active}");
              if let Ok(mut gate) = overlay_gate.lock() {
                gate.set_active(active, std::time::Instant::now());
              }
              tauri_plugin_steam_overlay_surface::on_overlay_activated(&handle, active);
              set_frontend_overlay_state(&handle, active);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
          }
        });
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app, event| {
      // Tauri can terminate the process without unwinding local destructors.
      // Stop the owned engine explicitly before runtime exit.
      if matches!(event, tauri::RunEvent::Exit) {
        if let Ok(mut engine) = streaming_engine.lock() { engine.stop(); }
      }
    });
}
