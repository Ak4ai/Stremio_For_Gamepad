const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const instances = [];
class ImageMock {
  constructor() { instances.push(this); }
  decode() { return new Promise((resolve) => { this.finishDecode = resolve; }); }
}
const exportsMock = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/logoImages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, { exports: exportsMock, Image: ImageMock, setTimeout, clearTimeout,
  require: () => ({ imdbArtwork: (_kind, id) => id.startsWith('tt') ? `https://images.test/${id}.png` : undefined }),
});
(async () => {
  const cache = exportsMock;
  let notifications = 0;
  const url = 'https://images.test/one.png';
  const unsubscribe = cache.subscribeLogoImage(url, () => notifications++);
  cache.preloadLogoImage(url);
  cache.preloadLogoImage(url, true);
  assert.equal(instances.length, 1, 'Hero/details/player must share one preload');
  assert.equal(cache.logoImageStatus(url), 'loading');
  instances[0].onload();
  assert.equal(cache.logoImageStatus(url), 'loading', 'Do not show an image before decoding completes');
  instances[0].finishDecode(); await Promise.resolve();
  assert.equal(cache.logoImageStatus(url), 'ready');
  cache.preloadLogoImage(url);
  assert.equal(instances.length, 1, 'Revisiting a prepared logo must be immediate');
  assert.ok(notifications >= 2);
  unsubscribe();
  for (let i = 0; i < 5; i++) cache.preloadLogoImage(`https://images.test/neighbor${i}.png`);
  assert.equal(instances.length, 5, 'Limit background loads to four at a time');
  instances[1].onerror();
  assert.equal(cache.logoImageStatus('https://images.test/neighbor0.png'), 'failed');
  assert.equal(instances.length, 6, 'A failed image must release its queue slot');
  cache.markLogoImageFailed(url);
  assert.equal(cache.logoImageStatus(url), 'failed');
  for (const image of instances) if (image.onerror) image.onerror();
  assert.equal(cache.mediaLogoUrl({ id: 'kitsu:1', logo: 'https://provider.test/logo.png' }), 'https://provider.test/logo.png');
  console.log('Logo cache checks passed: shared loads, decode readiness, immediate reuse, bounded concurrency and failure fallback.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
