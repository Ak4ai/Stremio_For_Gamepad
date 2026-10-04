const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename, requireMock, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: requireMock, URL, URLSearchParams,
    AbortSignal, AbortController, console, setTimeout, clearTimeout, ...globals });
  return exports;
}

const service = load('src/services/stremio.ts', () => ({})).StremioService;
const streamParser = load('src/utils/streamParser.ts', () => ({}));
const episodeNavigation = load('src/utils/episodeNavigation.ts', () => streamParser);
const settings = load('src/services/settings.ts', () => ({}), { localStorage: { setItem() {}, getItem() { return null; } } }).SettingsService;
const episodeVideos = [
  { id: 'show:2:1', season: 2, episode: 1 }, { id: 'show:1:2', season: 1, episode: 2 }, { id: 'show:1:1', season: 1, episode: 1 },
];
assert.equal(episodeNavigation.adjacentEpisodes(episodeVideos, 'show:1:2').next.id, 'show:2:1', 'episode navigation crosses season boundaries in order');
assert.equal(episodeNavigation.adjacentEpisodes(episodeVideos, 'show:1:1').previous, undefined);
assert.equal(episodeNavigation.adjacentEpisodes(episodeVideos, 'missing').next, undefined);
const matchingEpisode = { url: 'https://example.org/episode.mkv', name: 'Addon', title: '1080p DUAL PT-BR', behaviorHints: { bingeGroup: 'release' } };
assert.equal(episodeNavigation.preferredEpisodeStream([
  { externalUrl: 'https://example.org/watch' },
  { url: 'https://example.org/english.mkv', name: 'Other', title: '720p English' }, matchingEpisode,
], matchingEpisode), matchingEpisode, 'episode switches preserve the current release and audio when available');
assert.equal(episodeNavigation.preferredEpisodeStream([], matchingEpisode), undefined, 'missing playable sources keep the current episode');
const url = new URL(service.buildHlsPlaybackUrl({ url: 'https://example.org/movie.mkv?token=a&b=c' }, 'session'));
assert.equal(url.searchParams.get('mediaURL'), 'https://example.org/movie.mkv?token=a&b=c');
assert.equal(url.searchParams.get('audioCodecs'), 'aac');
assert.equal(url.searchParams.get('maxAudioChannels'), '2');
assert.equal(url.searchParams.get('videoCodecs'), 'h264');
assert.equal(service.buildHlsPlaybackUrl({ url: 'https://example.org/live.M3U8?token=x' }, 'session'), 'https://example.org/live.M3U8?token=x');
const protectedStream = { url: 'https://example.org/a%20movie.mkv?token=a%2Fb', behaviorHints: { proxyHeaders: {
  request: { Referer: 'https://example.org/watch', 'User-Agent': 'Stremio' }, response: { 'Access-Control-Allow-Origin': '*' },
} } };
const protectedURL = new URL(service.buildPlaybackUrl(protectedStream));
const proxyOptions = new URLSearchParams(protectedURL.pathname.split('/')[2]);
assert.equal(protectedURL.origin, 'http://127.0.0.1:11470');
assert.equal(proxyOptions.get('d'), 'https://example.org');
assert.deepEqual(proxyOptions.getAll('h'), ['Referer:https://example.org/watch', 'User-Agent:Stremio']);
assert.equal(proxyOptions.get('r'), 'Access-Control-Allow-Origin:*');
assert.ok(protectedURL.pathname.endsWith('/a%20movie.mkv'));
assert.equal(protectedURL.search, '?token=a%2Fb');
assert.equal(new URL(service.buildHlsPlaybackUrl(protectedStream, 'protected')).searchParams.get('mediaURL'), protectedURL.href, 'conversion retains required source headers');

async function scenario({ blocked = false, probe = null } = {}) {
  const effects = [], states = [], listeners = new Map(), windowListeners = new Map(), timers = new Map();
  const instances = [], released = [];
  let clock = 0, uuid = 0, playCalls = 0;
  const video = {
    currentTime: 0, duration: 100, paused: true, ended: false, muted: false,
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: (name) => listeners.delete(name),
    removeAttribute: () => { video.src = ''; }, load() {}, pause() { video.paused = true; },
    play() { playCalls++; if (blocked) return Promise.reject({ name: 'NotAllowedError' }); video.paused = false; return Promise.resolve(); },
  };
  let refIndex = 0;
  const react = {
    useRef: (value) => ({ current: refIndex++ === 0 ? video : value }),
    useState: (value) => [value, (next) => states.push(next)],
    useEffect: (effect) => effects.push(effect), useMemo: (fn) => fn(), useCallback: (fn) => fn,
  };
  class FakeHls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifest', AUDIO_TRACKS_UPDATED: 'tracks', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    constructor() { instances.push(this); this.events = {}; this.audioTracks = []; }
    on(name, cb) { this.events[name] = cb; }
    attachMedia() {} loadSource(url) { this.url = url; }
    destroy() { this.destroyed = true; } startLoad() {} recoverMediaError() {}
  }
  const mockService = { ...service,
    buildPlaybackUrl: (s) => service.buildPlaybackUrl(s),
    buildHlsPlaybackUrl: (s, id) => service.buildHlsPlaybackUrl(s, id),
    releaseHlsSession: (url) => released.push(url), probeMedia: async () => probe,
  };
  const { VideoPlayer } = load('src/components/VideoPlayer.tsx', (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} };
    if (name === 'hls.js') return FakeHls;
    if (name.includes('/stremio')) return { StremioService: mockService };
    if (name.includes('streamParser')) return { parseStream: () => ({}) };
    if (name.includes('episodeNavigation')) return episodeNavigation;
    if (name.includes('/settings')) return { SettingsService: settings };
    return {};
  }, { crypto: { randomUUID: () => `session-${++uuid}` },
    Date: { now: () => clock }, setInterval: (cb) => { timers.set(1, cb); return 1; }, clearInterval: (id) => timers.delete(id),
    window: { addEventListener: (name, cb) => windowListeners.set(name, cb), removeEventListener: (name) => windowListeners.delete(name) },
  });
  VideoPlayer({ stream: { url: 'https://example.org/movie.mp4' }, meta: { id: 'x', type: 'movie' }, onExit() {} });
  const mainEffect = effects.find((fn) => fn.toString().includes('let converted = false'));
  assert.ok(mainEffect);
  const cleanup = mainEffect();
  await new Promise(setImmediate);
  if (blocked) {
    assert.equal(playCalls, 1, 'autoplay must never retry muted');
    assert.equal(video.muted, false);
    clock = 90000; timers.get(1)();
    assert.equal(instances.length, 0, 'autoplay block is not a transport failure');
    blocked = false; windowListeners.get('pointerdown')();
    await new Promise(setImmediate);
    assert.equal(playCalls, 2);
  } else if (probe) {
    assert.equal(instances.length, 1, 'unsupported audio must use conversion before direct playback');
    assert.equal(playCalls, 0);
  } else {
    video.currentTime = 42;
    listeners.get('error')();
    assert.equal(instances.length, 1, 'direct decode errors must convert');
    instances[0].events.manifest();
    await new Promise(setImmediate);
    for (let n = 0; n < 4; n++) instances[0].events.error(null, { fatal: true, type: 'network' });
    assert.ok(states.some((value) => typeof value === 'string' && value.includes('motor')));
  }
  cleanup();
  assert.equal(video.src, '');
  assert.equal(listeners.size, 0);
  assert.equal(windowListeners.size, 0);
  assert.equal(timers.size, 0);
  if (instances.length) { assert.ok(instances[0].destroyed); assert.equal(released.length, 1); }
}

(async () => {
  await scenario({ blocked: true });
  await scenario();
  await scenario({ probe: { streams: [{ track: 'audio', codec: 'eac3', channels: 6 }] } });
  console.log('Playback regression checks passed: codec negotiation, autoplay, fallback, fatal errors and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
