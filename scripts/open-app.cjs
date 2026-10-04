const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function browserArgs(profile) {
  // A separate persistent process is required: an already running browser ignores
  // process flags. Scope autoplay permission to this app's own browser profile.
  return [`--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--app=http://127.0.0.1:3000', '--start-fullscreen'];
}

async function openApp() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const browser = candidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) throw new Error('Chrome ou Edge não encontrado. Instale um deles para abrir o app com reprodução automática.');
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const profile = path.join(process.env.LOCALAPPDATA || path.resolve(__dirname, '..'), 'StremioForGamepad', 'Browser');
        const child = spawn(browser, browserArgs(profile), { detached: true, stdio: 'ignore' });
        child.on('error', (error) => console.error(error.message));
        child.unref();
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('A interface não iniciou na porta 3000. Confira a janela do motor.');
}

module.exports = { browserArgs };
if (require.main === module) openApp().catch((error) => { console.error(error.message); process.exitCode = 1; });
