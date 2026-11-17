//! Local extensions: Stremio addons that run on this machine, with no hosting.
//!
//! An extension is a folder with a `package.json` and a Node entry point that
//! speaks the Stremio addon protocol over HTTP. The app unpacks it under its
//! data directory, starts it with the bundled Node runtime on a loopback port
//! and the frontend registers it like any other addon (`transportUrl`).
//!
//! Sources accepted by `install`: a folder, a `.zip`, a GitHub repository link
//! (latest release `.zip`, else the default branch) or a direct `.zip` link.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const BASE_PORT: u16 = 17000;
const PORT_SPAN: u16 = 900;

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
  id: String,
  name: String,
  version: String,
  /// Entry point relative to the package folder.
  entry: String,
  source: String,
  enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
  id: String,
  name: String,
  version: String,
  source: String,
  enabled: bool,
  running: bool,
  url: Option<String>,
  /// Tail of the extension log when it is enabled but not running.
  last_error: Option<String>,
}

struct Inner {
  entries: Vec<Entry>,
  running: HashMap<String, (Child, u16)>,
}

pub struct LocalAddons {
  root: PathBuf,
  inner: Mutex<Inner>,
  installing: AtomicBool,
}

impl Drop for LocalAddons {
  fn drop(&mut self) { self.stop_all(); }
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
  use std::os::windows::process::CommandExt;
  cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

fn system_tool(name: &str) -> PathBuf {
  if let Ok(root) = std::env::var("SystemRoot") {
    let path = Path::new(&root).join("System32").join(name);
    if path.exists() { return path; }
  }
  PathBuf::from(name)
}

fn fnv1a(text: &str) -> u32 {
  text.bytes().fold(0x811c9dc5u32, |hash, byte| (hash ^ byte as u32).wrapping_mul(0x01000193))
}

fn sanitize_id(raw: &str) -> String {
  let base = raw.rsplit('/').next().unwrap_or(raw);
  let cleaned: String = base
    .to_lowercase()
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
    .collect();
  cleaned.trim_matches('-').to_string()
}

fn last_lines(text: &str, count: usize) -> String {
  let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
  lines[lines.len().saturating_sub(count)..].join("\n")
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
  fs::create_dir_all(to).map_err(|e| format!("Não consegui criar {}: {e}", to.display()))?;
  for item in fs::read_dir(from).map_err(|e| format!("Não consegui ler {}: {e}", from.display()))? {
    let item = item.map_err(|e| e.to_string())?;
    let name = item.file_name();
    if name == ".git" { continue; }
    let kind = item.file_type().map_err(|e| e.to_string())?;
    if kind.is_symlink() { continue; }
    let target = to.join(&name);
    if kind.is_dir() {
      copy_dir(&item.path(), &target)?;
    } else {
      fs::copy(item.path(), &target).map_err(|e| format!("Falha ao copiar {}: {e}", name.to_string_lossy()))?;
    }
  }
  Ok(())
}

/// Finds the folder holding the addon: GitHub zips wrap everything in one directory.
fn find_addon_root(dir: &Path, depth: u8) -> Option<PathBuf> {
  if dir.join("package.json").exists() || dir.join("index.js").exists() {
    return Some(dir.to_path_buf());
  }
  if depth == 0 { return None; }
  let mut folders = fs::read_dir(dir).ok()?
    .filter_map(|e| e.ok())
    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && e.file_name() != "__MACOSX")
    .map(|e| e.path());
  let only = folders.next()?;
  if folders.next().is_some() { return None; }
  find_addon_root(&only, depth - 1)
}

fn download(url: &str, out: &Path) -> Result<(), String> {
  let mut cmd = Command::new(system_tool("curl.exe"));
  cmd.args(["-L", "--fail", "--silent", "--show-error", "--max-time", "180", "-A", "Stremio-For-Gamepad"])
    .arg("-o").arg(out).arg(url)
    .stdout(Stdio::null());
  hide_window(&mut cmd);
  let output = cmd.output().map_err(|e| format!("Não consegui executar o curl: {e}"))?;
  if output.status.success() { return Ok(()); }
  let reason = String::from_utf8_lossy(&output.stderr);
  Err(format!("Falha ao baixar {url}: {}", last_lines(&reason, 2)))
}

fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
  fs::create_dir_all(dest).map_err(|e| e.to_string())?;
  let mut cmd = Command::new(system_tool("tar.exe"));
  cmd.arg("-xf").arg(zip).arg("-C").arg(dest);
  hide_window(&mut cmd);
  let output = cmd.output().map_err(|e| format!("Não consegui executar o tar: {e}"))?;
  if output.status.success() { return Ok(()); }
  let reason = String::from_utf8_lossy(&output.stderr);
  Err(format!("Não consegui extrair o .zip: {}", last_lines(&reason, 2)))
}

/// Maps a github.com link to a downloadable zip: latest release asset, else the source archive.
fn github_zip_url(url: &str, scratch: &Path) -> Result<Option<String>, String> {
  let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
  let mut parts = rest.split(['?', '#']).next().unwrap_or(rest).trim_matches('/').split('/');
  let host = parts.next().unwrap_or("").to_lowercase();
  if host != "github.com" && host != "www.github.com" { return Ok(None); }
  let owner = parts.next().ok_or("Link do GitHub sem dono do repositório.")?;
  let repo = parts.next().ok_or("Link do GitHub sem nome do repositório.")?;
  let repo = repo.strip_suffix(".git").unwrap_or(repo);

  // A link to a specific branch (…/tree/<branch>) is taken literally.
  if parts.next() == Some("tree") {
    let branch: Vec<&str> = parts.collect();
    if !branch.is_empty() {
      return Ok(Some(format!("https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{}", branch.join("/"))));
    }
  }

  let release_json = scratch.join("release.json");
  if download(&format!("https://api.github.com/repos/{owner}/{repo}/releases/latest"), &release_json).is_ok() {
    let parsed: serde_json::Value = fs::read_to_string(&release_json).ok()
      .and_then(|text| serde_json::from_str(&text).ok())
      .unwrap_or(serde_json::Value::Null);
    let asset = parsed["assets"].as_array().and_then(|assets| {
      assets.iter().filter_map(|a| a["browser_download_url"].as_str())
        .find(|u| u.to_lowercase().ends_with(".zip"))
        .map(str::to_string)
    });
    if asset.is_some() { return Ok(asset); }
  }
  Ok(Some(format!("https://api.github.com/repos/{owner}/{repo}/zipball")))
}

fn install_dependencies(pkg_dir: &Path) -> Result<(), String> {
  let needs = fs::read_to_string(pkg_dir.join("package.json")).ok()
    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    .and_then(|json| json["dependencies"].as_object().map(|d| !d.is_empty()))
    .unwrap_or(false);
  if !needs || pkg_dir.join("node_modules").exists() { return Ok(()); }

  let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
  let mut cmd = Command::new(npm);
  cmd.args(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
    .current_dir(pkg_dir);
  hide_window(&mut cmd);
  let output = cmd.output().map_err(|_| {
    "A extensão precisa de dependências (npm), mas o npm não está instalado. \
     Instale o Node.js ou use um pacote que já venha com a pasta node_modules.".to_string()
  })?;
  if output.status.success() { return Ok(()); }
  let reason = String::from_utf8_lossy(&output.stderr);
  Err(format!("npm install falhou: {}", last_lines(&reason, 4)))
}

fn node_runtime() -> PathBuf {
  if let Some(dir) = crate::find_server_dir() {
    let bundled = dir.join("stremio-runtime.exe");
    if bundled.exists() { return bundled; }
  }
  PathBuf::from("node")
}

impl LocalAddons {
  pub fn load(root: PathBuf) -> Self {
    let _ = fs::create_dir_all(&root);
    let entries = fs::read_to_string(root.join("registry.json")).ok()
      .and_then(|text| serde_json::from_str(&text).ok())
      .unwrap_or_default();
    LocalAddons {
      root,
      inner: Mutex::new(Inner { entries, running: HashMap::new() }),
      installing: AtomicBool::new(false),
    }
  }

  fn pkg_dir(&self, id: &str) -> PathBuf { self.root.join("pkgs").join(id) }
  fn data_dir(&self, id: &str) -> PathBuf { self.root.join("data").join(id) }
  fn log_path(&self, id: &str) -> PathBuf { self.root.join("logs").join(format!("{id}.log")) }

  fn save(&self, inner: &Inner) {
    if let Ok(text) = serde_json::to_string_pretty(&inner.entries) {
      let _ = fs::write(self.root.join("registry.json"), text);
    }
  }

  fn reap(inner: &mut Inner) {
    inner.running.retain(|_, (child, _)| child.try_wait().ok().flatten().is_none());
  }

  fn start_locked(&self, inner: &mut Inner, id: &str) -> Result<(), String> {
    Self::reap(inner);
    if inner.running.contains_key(id) { return Ok(()); }
    let entry = inner.entries.iter().find(|e| e.id == id).cloned().ok_or("Extensão não encontrada.")?;
    let pkg = self.pkg_dir(id);
    let script = pkg.join(&entry.entry);
    if !script.exists() { return Err(format!("Arquivo de entrada ausente: {}", entry.entry)); }

    let used: HashSet<u16> = inner.running.values().map(|(_, port)| *port).collect();
    let start = (fnv1a(id) % PORT_SPAN as u32) as u16;
    let port = (0..PORT_SPAN)
      .map(|i| BASE_PORT + (start + i) % PORT_SPAN)
      .find(|p| !used.contains(p) && std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok())
      .ok_or("Nenhuma porta livre para a extensão.")?;

    let data = self.data_dir(id);
    let _ = fs::create_dir_all(&data);
    let _ = fs::create_dir_all(self.root.join("logs"));
    let log = fs::File::create(self.log_path(id)).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(node_runtime());
    cmd.arg(&script)
      .current_dir(&pkg)
      .env("PORT", port.to_string())
      .env("HOST", "127.0.0.1")
      .env("ADDON_DATA_DIR", &data)
      .stdin(Stdio::null())
      .stdout(Stdio::from(log))
      .stderr(Stdio::from(log_err));
    hide_window(&mut cmd);
    let child = cmd.spawn().map_err(|e| format!("Não consegui iniciar a extensão: {e}"))?;
    inner.running.insert(id.to_string(), (child, port));
    Ok(())
  }

  fn stop_locked(inner: &mut Inner, id: &str) {
    if let Some((mut child, _)) = inner.running.remove(id) {
      let _ = child.kill();
      let _ = child.wait();
    }
  }

  pub fn start_enabled(&self) {
    let Ok(mut inner) = self.inner.lock() else { return; };
    let ids: Vec<String> = inner.entries.iter().filter(|e| e.enabled).map(|e| e.id.clone()).collect();
    for id in ids {
      if let Err(err) = self.start_locked(&mut inner, &id) { log::warn!("Local addon {id}: {err}"); }
    }
  }

  pub fn stop_all(&self) {
    if let Ok(mut inner) = self.inner.lock() {
      let ids: Vec<String> = inner.running.keys().cloned().collect();
      for id in ids { Self::stop_locked(&mut inner, &id); }
    }
  }

  fn info(&self, inner: &Inner, entry: &Entry) -> AddonInfo {
    let port = inner.running.get(&entry.id).map(|(_, port)| *port);
    let last_error = if entry.enabled && port.is_none() {
      fs::read_to_string(self.log_path(&entry.id)).ok()
        .map(|text| last_lines(&text, 6))
        .filter(|text| !text.is_empty())
    } else {
      None
    };
    AddonInfo {
      id: entry.id.clone(),
      name: entry.name.clone(),
      version: entry.version.clone(),
      source: entry.source.clone(),
      enabled: entry.enabled,
      running: port.is_some(),
      url: port.map(|p| format!("http://127.0.0.1:{p}/manifest.json")),
      last_error,
    }
  }

  pub fn list(&self) -> Vec<AddonInfo> {
    let Ok(mut inner) = self.inner.lock() else { return Vec::new(); };
    Self::reap(&mut inner);
    inner.entries.iter().map(|e| self.info(&inner, e)).collect()
  }

  pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<Vec<AddonInfo>, String> {
    {
      let mut inner = self.inner.lock().map_err(|_| "Estado indisponível.")?;
      let entry = inner.entries.iter_mut().find(|e| e.id == id).ok_or("Extensão não encontrada.")?;
      entry.enabled = enabled;
      if enabled {
        self.start_locked(&mut inner, id)?;
      } else {
        Self::stop_locked(&mut inner, id);
      }
      self.save(&inner);
    }
    Ok(self.list())
  }

  pub fn remove(&self, id: &str) -> Result<Vec<AddonInfo>, String> {
    {
      let mut inner = self.inner.lock().map_err(|_| "Estado indisponível.")?;
      Self::stop_locked(&mut inner, id);
      inner.entries.retain(|e| e.id != id);
      self.save(&inner);
    }
    let _ = fs::remove_dir_all(self.pkg_dir(id));
    let _ = fs::remove_file(self.log_path(id));
    Ok(self.list())
  }

  pub fn log(&self, id: &str) -> String {
    fs::read_to_string(self.log_path(id)).map(|t| last_lines(&t, 40)).unwrap_or_default()
  }

  pub fn install(&self, source: &str) -> Result<AddonInfo, String> {
    if self.installing.swap(true, Ordering::AcqRel) {
      return Err("Já existe uma instalação em andamento.".into());
    }
    let scratch = self.root.join("tmp").join(format!("{}", std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    let result = self.install_from(source.trim().trim_matches('"'), &scratch);
    let _ = fs::remove_dir_all(&scratch);
    self.installing.store(false, Ordering::Release);
    result
  }

  fn install_from(&self, source: &str, scratch: &Path) -> Result<AddonInfo, String> {
    if source.is_empty() { return Err("Informe uma pasta, um .zip ou um link.".into()); }
    fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let unpacked = scratch.join("unpacked");

    let origin: PathBuf = if source.starts_with("http://") || source.starts_with("https://") {
      let zip_url = github_zip_url(source, scratch)?.unwrap_or_else(|| source.to_string());
      let zip = scratch.join("download.zip");
      download(&zip_url, &zip)?;
      extract_zip(&zip, &unpacked)?;
      unpacked.clone()
    } else {
      let path = PathBuf::from(source);
      if path.is_dir() {
        path
      } else if path.is_file() && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
        extract_zip(&path, &unpacked)?;
        unpacked.clone()
      } else {
        return Err("Caminho inválido: use uma pasta, um arquivo .zip ou um link http(s).".into());
      }
    };

    let root = find_addon_root(&origin, 3)
      .ok_or("Não encontrei package.json nem index.js nessa extensão.")?;
    let package: serde_json::Value = fs::read_to_string(root.join("package.json")).ok()
      .and_then(|text| serde_json::from_str(&text).ok())
      .unwrap_or(serde_json::Value::Null);

    let entry_file = package["main"].as_str().unwrap_or("index.js").trim_start_matches("./").to_string();
    if entry_file.contains("..") || !root.join(&entry_file).is_file() {
      return Err(format!("Arquivo de entrada não encontrado: {entry_file}"));
    }

    let fallback_name = root.file_name().and_then(|n| n.to_str()).unwrap_or("extensao");
    let raw_name = package["name"].as_str().unwrap_or(fallback_name);
    let id = sanitize_id(raw_name);
    if id.is_empty() { return Err("Não consegui definir um nome para a extensão.".into()); }
    let version = package["version"].as_str().unwrap_or("1.0.0").to_string();

    // Replace a previous install of the same extension (its data folder is kept).
    {
      let mut inner = self.inner.lock().map_err(|_| "Estado indisponível.")?;
      Self::stop_locked(&mut inner, &id);
    }
    let pkg = self.pkg_dir(&id);
    let _ = fs::remove_dir_all(&pkg);
    copy_dir(&root, &pkg)?;
    if let Err(err) = install_dependencies(&pkg) {
      let _ = fs::remove_dir_all(&pkg);
      return Err(err);
    }

    let mut inner = self.inner.lock().map_err(|_| "Estado indisponível.")?;
    let entry = Entry {
      id: id.clone(),
      name: raw_name.to_string(),
      version,
      entry: entry_file,
      source: source.to_string(),
      enabled: true,
    };
    match inner.entries.iter_mut().find(|e| e.id == id) {
      Some(existing) => *existing = entry,
      None => inner.entries.push(entry),
    }
    self.save(&inner);
    self.start_locked(&mut inner, &id)?;
    let saved = inner.entries.iter().find(|e| e.id == id).cloned().ok_or("Extensão não encontrada.")?;
    Ok(self.info(&inner, &saved))
  }
}

#[tauri::command]
pub fn local_addons_list(app: tauri::AppHandle) -> Vec<AddonInfo> {
  app.state::<LocalAddons>().list()
}

#[tauri::command]
pub async fn local_addons_install(app: tauri::AppHandle, source: String) -> Result<AddonInfo, String> {
  tauri::async_runtime::spawn_blocking(move || app.state::<LocalAddons>().install(&source))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn local_addons_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<Vec<AddonInfo>, String> {
  app.state::<LocalAddons>().set_enabled(&id, enabled)
}

#[tauri::command]
pub fn local_addons_remove(app: tauri::AppHandle, id: String) -> Result<Vec<AddonInfo>, String> {
  app.state::<LocalAddons>().remove(&id)
}

#[tauri::command]
pub fn local_addons_log(app: tauri::AppHandle, id: String) -> String {
  app.state::<LocalAddons>().log(&id)
}

/// Native picker so the user can choose a folder or `.zip` without typing a path.
#[tauri::command]
pub async fn local_addons_browse(kind: String) -> Option<String> {
  tauri::async_runtime::spawn_blocking(move || {
    let dialog = if kind == "folder" {
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog; \
       $d.Description = 'Escolha a pasta da extensão'; \
       if ($d.ShowDialog($o) -eq 'OK') { $d.SelectedPath }"
    } else {
      "$d = New-Object System.Windows.Forms.OpenFileDialog; \
       $d.Filter = 'Extensão (*.zip)|*.zip'; \
       if ($d.ShowDialog($o) -eq 'OK') { $d.FileName }"
    };
    // The invisible topmost owner keeps the dialog in front of the fullscreen app.
    let script = format!(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
       Add-Type -AssemblyName System.Windows.Forms; \
       $o = New-Object System.Windows.Forms.Form -Property @{{ TopMost = $true }}; {dialog}"
    );
    let mut cmd = Command::new(system_tool("WindowsPowerShell\\v1.0\\powershell.exe"));
    cmd.args(["-NoProfile", "-NonInteractive", "-STA", "-Command", &script]);
    hide_window(&mut cmd);
    let output = cmd.output().ok()?;
    let picked = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if picked.is_empty() { None } else { Some(picked) }
  })
  .await
  .ok()
  .flatten()
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};

  fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("local-addons-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// Minimal addon: answers the manifest on $PORT, like a real Stremio addon would.
  fn write_fixture(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("package.json"), r#"{"name":"fixture-addon","version":"1.2.3","main":"index.js"}"#).unwrap();
    fs::write(dir.join("index.js"), r#"
      const http = require('http');
      http.createServer((req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'fixture', version: '1.2.3', name: 'Fixture', resources: ['stream'], types: ['movie'], catalogs: [] }));
      }).listen(process.env.PORT, process.env.HOST);
    "#).unwrap();
  }

  fn fetch_manifest(url: &str) -> String {
    let port: u16 = url.split(':').nth(2).unwrap().split('/').next().unwrap().parse().unwrap();
    for _ in 0..40 {
      if let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) {
        stream.write_all(b"GET /manifest.json HTTP/1.0\r\nHost: localhost\r\n\r\n").unwrap();
        let mut body = String::new();
        stream.read_to_string(&mut body).unwrap();
        return body;
      }
      std::thread::sleep(std::time::Duration::from_millis(250));
    }
    panic!("extension never started listening on {url}");
  }

  #[test]
  fn installs_from_folder_and_runs() {
    let root = scratch("folder");
    let source = root.join("src").join("fixture");
    write_fixture(&source);

    let addons = LocalAddons::load(root.join("data"));
    let info = addons.install(source.to_str().unwrap()).expect("install");
    assert_eq!(info.id, "fixture-addon");
    assert!(info.running, "should be running: {:?}", info.last_error);
    assert!(fetch_manifest(info.url.as_ref().unwrap()).contains("\"name\":\"Fixture\""));

    // Disable stops it, enable starts it again, remove deletes it.
    let after = addons.set_enabled("fixture-addon", false).unwrap();
    assert!(!after[0].running);
    let after = addons.set_enabled("fixture-addon", true).unwrap();
    assert!(after[0].running);
    assert!(addons.remove("fixture-addon").unwrap().is_empty());
    assert!(!addons.pkg_dir("fixture-addon").exists());

    // The registry survives a restart.
    let again = LocalAddons::load(root.join("data"));
    assert!(again.list().is_empty());
  }

  #[test]
  fn installs_from_wrapped_zip_and_restores_after_restart() {
    let root = scratch("zip");
    write_fixture(&root.join("pack").join("wrapper").join("fixture"));
    let zip = root.join("fixture.zip");
    let status = Command::new(system_tool("tar.exe"))
      .args(["-a", "-cf"]).arg(&zip).arg("-C").arg(root.join("pack")).arg("wrapper")
      .status().expect("tar");
    assert!(status.success());

    let addons = LocalAddons::load(root.join("data"));
    let info = addons.install(zip.to_str().unwrap()).expect("install zip");
    assert!(fetch_manifest(info.url.as_ref().unwrap()).contains("Fixture"));
    addons.stop_all();

    let restarted = LocalAddons::load(root.join("data"));
    assert_eq!(restarted.list().len(), 1);
    restarted.start_enabled();
    let listed = restarted.list();
    assert!(listed[0].running, "should auto-start: {:?}", listed[0].last_error);
  }

  #[test]
  fn rejects_bad_sources() {
    let root = scratch("bad");
    let addons = LocalAddons::load(root.join("data"));
    assert!(addons.install("").is_err());
    assert!(addons.install(r"C:\nao\existe\mesmo").is_err());
    let empty = root.join("empty");
    fs::create_dir_all(&empty).unwrap();
    assert!(addons.install(empty.to_str().unwrap()).is_err());
  }

  /// Needs internet: `cargo test -- --ignored`.
  #[test]
  #[ignore]
  fn installs_from_github_repository() {
    let root = scratch("github");
    let addons = LocalAddons::load(root.join("data"));
    let info = addons.install("https://github.com/Ak4ai/cinefy-stremio-addon-prototipo").expect("install github");
    assert!(info.running, "should be running: {:?}", info.last_error);
    let body = fetch_manifest(info.url.as_ref().unwrap());
    assert!(body.contains("Cinefy"), "unexpected manifest: {body}");
  }
}
