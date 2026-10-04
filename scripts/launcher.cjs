const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, '..', 'bin', 'server');
const SERVER_SCRIPT = path.join(SERVER_DIR, 'server.js');
const ROOT_DIR = path.join(__dirname, '..');

// Helper to check if port 11470 is alive
function isServerAlive() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11470/stats.json', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.abort();
      resolve(false);
    });
  });
}

async function main() {
  console.log('[Stremio Deck] Verificando motor de streaming...');

  let alive = await isServerAlive();

  if (alive) {
    console.log('[Stremio Deck] Motor do Stremio já está ativo na porta 11470.');
  } else {
    console.log('[Stremio Deck] Iniciando motor oficial em segundo plano...');

    // Determine executable (stremio-runtime or system node)
    const runtimePath = path.join(SERVER_DIR, 'stremio-runtime.exe');
    const hasRuntime = fs.existsSync(runtimePath);
    const cmd = hasRuntime ? runtimePath : 'node';

    const ffmpegPath = path.join(SERVER_DIR, 'ffmpeg.exe');
    const ffprobePath = path.join(SERVER_DIR, 'ffprobe.exe');

    const serverProc = spawn(cmd, [SERVER_SCRIPT], {
      cwd: SERVER_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        FFMPEG_BIN: ffmpegPath,
        FFPROBE_BIN: ffprobePath,
        PATH: `${SERVER_DIR};${process.env.PATH || ''}`,
      },
    });

    serverProc.unref();

    // Poll until ready (up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      alive = await isServerAlive();
      if (alive) {
        console.log('[Stremio Deck] Motor pronto na porta 11470!');
        break;
      }
    }
  }

  // Start Vite frontend
  try {
    const existing = await fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(1000) });
    if (existing.ok && (await existing.text()).includes('<title>stremio-for-gamepad</title>')) {
      console.log('[Stremio Deck] Interface já ativa na porta 3000.');
      return;
    }
  } catch {}
  console.log('[Stremio Deck] Iniciando interface Xbox...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  
  const viteProc = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });

  viteProc.on('close', (code) => {
    process.exit(code);
  });
}

main().catch((err) => {
  console.error('[Stremio Deck Error]', err);
  process.exit(1);
});
