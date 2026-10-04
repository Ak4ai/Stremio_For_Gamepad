use std::process::{Command, Stdio};
use std::path::PathBuf;

fn ensure_stremio_server() {
  // Check if Stremio streaming engine is already active on port 11470
  if std::net::TcpStream::connect("127.0.0.1:11470").is_ok() {
    return;
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

    let _ = cmd.spawn();
  }
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

struct SteamState(Option<steamworks::Client>);

#[tauri::command]
fn is_steam_running(state: tauri::State<'_, SteamState>) -> bool {
  state.0.is_some()
}

#[tauri::command]
fn activate_steam_overlay(state: tauri::State<'_, SteamState>) -> bool {
  if let Some(client) = state.0.as_ref() {
    client.friends().activate_game_overlay("");
    return true;
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("cmd")
      .args(["/c", "start", "", "steam://open/gamepadui"])
      .creation_flags(0x08000000)
      .spawn();
  }
  false
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
  ensure_stremio_server();

  // 1. SteamAPI_Init before building Tauri so GameOverlayRenderer64.dll hooks the swapchain
  let (steam_client, steam_single) = match steamworks::Client::init_app(480) {
    Ok((c, s)) => (Some(c), Some(s)),
    Err(_) => (None, None),
  };

  if let Some(single) = steam_single {
    std::thread::spawn(move || loop {
      single.run_callbacks();
      std::thread::sleep(std::time::Duration::from_millis(50));
    });
  }

  let steam_clone = steam_client.clone();

  tauri::Builder::default()
    .plugin(tauri_plugin_steam_overlay_surface::init())
    .invoke_handler(tauri::generate_handler![
      set_fullscreen,
      is_fullscreen,
      minimize_app,
      close_app,
      open_in_browser,
      is_steam_running,
      activate_steam_overlay
    ])
    .setup(move |app| {
      app.manage(SteamState(steam_clone));

      if let Some(client) = &steam_client {
        let handle = app.handle().clone();
        let cb = client.register_callback(move |ev: steamworks::GameOverlayActivated| {
          tauri_plugin_steam_overlay_surface::on_overlay_activated(&handle, ev.active);
        });
        std::mem::forget(cb);
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
