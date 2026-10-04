// Integration check using only generated media and the bundled official engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'bin', 'server');
const base = 'http://127.0.0.1:11470';

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-playback-'));
  let engine, mediaServer, session;
  const log = fs.openSync(path.join(temp, 'engine.log'), 'w');
  try {
    const fixture = path.join(temp, 'surround.mkv');
    await exec(path.join(bin, 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '8', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-c:a', 'ac3', '-ac', '6', '-y', fixture]);
    const data = fs.readFileSync(fixture);
    let requiredHeaders = false;
    mediaServer = http.createServer((req, res) => {
      if (requiredHeaders && (req.headers.referer !== 'https://example.org/watch' || req.headers['user-agent'] !== 'Stremio')) {
        res.writeHead(403); res.end('Required source headers missing'); return;
      }
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) });
      res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
    });
    await new Promise((resolve) => mediaServer.listen(0, '127.0.0.1', resolve));
    let alive = false;
    try { alive = (await fetch(`${base}/stats.json`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
    if (!alive) {
      engine = spawn(path.join(bin, 'stremio-runtime.exe'), [path.join(bin, 'server.js')], {
        cwd: bin, windowsHide: true, stdio: ['ignore', log, log],
        env: { ...process.env, FFMPEG_BIN: path.join(bin, 'ffmpeg.exe'), FFPROBE_BIN: path.join(bin, 'ffprobe.exe') },
      });
      for (let n = 0; n < 30; n++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try { if ((await fetch(`${base}/stats.json`, { signal: AbortSignal.timeout(1000) })).ok) { alive = true; break; } } catch {}
      }
    }
    assert.ok(alive, 'streaming engine must start');
    const sourceOrigin = `http://127.0.0.1:${mediaServer.address().port}`;
    requiredHeaders = true;
    const rejected = await fetch(`${sourceOrigin}/surround.mkv`);
    assert.equal(rejected.status, 403);
    const proxyOptions = new URLSearchParams({ d: sourceOrigin });
    proxyOptions.append('h', 'Referer:https://example.org/watch');
    proxyOptions.append('h', 'User-Agent:Stremio');
    const mediaURL = `${base}/proxy/${proxyOptions}/surround.mkv`;
    const proxied = await fetch(mediaURL, { headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(5000) });
    if (proxied.status !== 206) throw new Error(`Official proxy returned ${proxied.status}: ${await proxied.text()}`);
    assert.equal((await proxied.arrayBuffer()).byteLength, 16);
    const query = new URLSearchParams({ mediaURL, videoCodecs: 'h264', audioCodecs: 'aac', maxAudioChannels: '2' });
    const probe = await fetch(`${base}/hlsv2/probe?${new URLSearchParams({ mediaURL })}`, { signal: AbortSignal.timeout(15000) });
    assert.ok(probe.ok);
    const info = await probe.json();
    assert.ok(info.streams.some((s) => s.track === 'audio' && s.codec === 'ac3' && s.channels === 6));
    assert.ok(info.streams.some((s) => s.track === 'video' && s.codec === 'hevc'));
    session = `regression-${Date.now()}`;
    const response = await fetch(`${base}/hlsv2/${session}/master.m3u8?${query}`, { signal: AbortSignal.timeout(30000) });
    const manifest = await response.text();
    assert.ok(response.ok, manifest);
    const audioURI = manifest.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"]+)"/);
    assert.ok(audioURI, manifest);
    const audioURL = new URL(audioURI[1], response.url).href;
    const videoURI = manifest.split('\n').find((line) => line && !line.startsWith('#'));
    assert.ok(videoURI);
    const videoOutput = await exec(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', new URL(videoURI, response.url).href], { timeout: 45000 });
    assert.ok(JSON.parse(videoOutput.stdout).streams.some((s) => s.codec_name === 'h264'), 'HEVC converts to playable H264 using current FFmpeg');
    const result = await exec(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', audioURL], { timeout: 45000 });
    const output = JSON.parse(result.stdout);
    assert.ok(output.streams.some((s) => s.codec_name === 'aac' && s.channels === 2), result.stdout);
    console.log('Official engine integration passed: protected headers, range requests, HEVC to H264 and AC3 5.1 to AAC stereo.');
  } finally {
    if (session) await fetch(`${base}/hlsv2/${session}/destroy`, { signal: AbortSignal.timeout(3000) }).catch(() => {});
    if (engine) { engine.kill(); await new Promise((resolve) => engine.once('exit', resolve)); }
    if (mediaServer) { mediaServer.closeAllConnections(); await new Promise((resolve) => mediaServer.close(resolve)); }
    fs.closeSync(log);
    console.log(`Integration artifacts: ${temp}`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
