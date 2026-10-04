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

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      set_fullscreen,
      is_fullscreen,
      minimize_app,
      close_app,
      open_in_browser
    ])
    .setup(|app| {
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
