const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const storage = new Map();
const modules = new Map();
const requests = [];
let offline = false;
let addonDown = false;
const fetchMock = async (url) => {
  requests.push(url);
  await Promise.resolve();
  if (offline) throw new Error('offline');
  if (addonDown && new URL(url).hostname === 'anime-kitsu.strem.fun') throw new Error('addon unavailable');
  if (new URL(url).hostname === 'kitsu.app') return { ok: true, json: async () => ({ data: {
    id: new URL(url).pathname.split('/').at(-1), attributes: { canonicalTitle: 'Official Kitsu title',
      posterImage: { large: 'https://media.kitsu.app/fallback.jpg' }, synopsis: 'Official synopsis' },
  } }) };
  const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1).replace(/\.json$/, ''));
  return { ok: true, json: async () => ({ meta: { id, type: 'series', name: 'Cowboy Bebop',
    poster: 'https://media.kitsu.app/poster.jpg', background: 'https://media.kitsu.app/cover.jpg',
    logo: 'https://example.test/logo.png', description: 'Synopsis',
    videos: [{ id: `${id}:1:1`, season: 1, episode: 1 }] } }) };
};
function load(path) {
  if (modules.has(path)) return modules.get(path);
  const exports = {};
  modules.set(path, exports);
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText;
  vm.runInNewContext(code, { exports, console, fetch: fetchMock, AbortSignal, URL, Date,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    require: (name) => load(require('node:path').posix.normalize(`${require('node:path').posix.dirname(path)}/${name}.ts`)),
  }, { filename: path });
  return exports;
}
(async () => {
  const { MetadataService, supportsMeta, imdbArtwork } = load('src/services/metadata.ts');
  const { isContinueWatching } = load('src/utils/libraryProgress.ts');
  const addon = { transportUrl: 'https://provider.test/configuration/manifest.json', manifest: {
    types: ['movie'], idPrefixes: ['tt'], resources: [{ name: 'meta', types: ['series'], idPrefixes: ['kitsu:'] }],
  } };
  assert.equal(supportsMeta(addon, 'series', 'kitsu:1'), true);
  assert.equal(supportsMeta(addon, 'movie', 'tt1'), false);
  assert.equal(imdbArtwork('poster', 'kitsu:1'), undefined);
  assert.ok(imdbArtwork('logo', 'tt0816692').includes('/logo/'));
  const [a, b] = await Promise.all([
    MetadataService.getMeta('series', 'kitsu:1', [addon]), MetadataService.getMeta('series', 'kitsu:1', [addon]),
  ]);
  assert.equal(a, b);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].startsWith('https://provider.test/configuration/meta/series/kitsu%3A1'));
  assert.equal(a.videos[0].id, 'kitsu:1:1:1');
  assert.equal(await MetadataService.getMeta('series', 'other:1', []), null);
  assert.equal(requests.length, 1, 'Unknown IDs must not be sent to Cinemeta');
  await MetadataService.getMeta('series', 'kitsu:2', []);
  assert.ok(requests.at(-1).startsWith('https://anime-kitsu.strem.fun/meta/'));
  addonDown = true;
  const fallback = await MetadataService.getMeta('series', 'kitsu:4', []);
  assert.equal(fallback.id, 'kitsu:4');
  assert.equal(fallback.poster, 'https://media.kitsu.app/fallback.jpg');
  assert.equal(fallback.videos, undefined, 'Artwork fallback must not invent playable episode IDs');
  addonDown = false;
  assert.equal(isContinueWatching({ timeOffset: 120, duration: 0 }), true);
  assert.equal(isContinueWatching({ timeOffset: 120 }), true);
  assert.equal(isContinueWatching({ timeOffset: 96, duration: 100 }), false);
  assert.equal(isContinueWatching({ timeOffset: 0 }), false);
  const { AccountService } = load('src/services/account.ts');
  const state = { timeOffset: 120, video_id: 'kitsu:3:1:2', duration: 0 };
  const items = [{ _id: 'kitsu:3', type: 'series', name: 'Saved title', state }];
  AccountService.userLibrary = items;
  const enriched = await AccountService.enrichLibrary(items);
  assert.equal(enriched[0]._id, 'kitsu:3');
  assert.equal(enriched[0].state, state);
  assert.equal(enriched[0].name, 'Saved title');
  assert.ok(enriched[0].poster.includes('kitsu.app'));
  assert.equal(items[0].poster, undefined, 'Keep the initial library immutable');
  offline = true;
  const offlineItems = [{ _id: 'kitsu:999', type: 'anime', name: 'Offline title', state }];
  AccountService.userLibrary = offlineItems;
  const preserved = await AccountService.enrichLibrary(offlineItems);
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0], offlineItems[0], 'Provider failure must preserve the saved card');
  console.log('Metadata checks passed: addon resource filters, Kitsu routing, deduplication, logos, missing duration, progress preservation and offline cards.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
