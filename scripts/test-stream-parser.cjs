const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync('src/utils/streamParser.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(code, { exports: exportsObject });
const { parseStream } = exportsObject;

const cases = [
  ['[Erai-raws] Tongari Boushi no Atelier - 11 [1080p][MultiSub]\nMulti Subs / 🇬🇧 / 🇵🇹 / 🇫🇷', false, false],
  ['1080p [Multi-Subs] [PT-BR]', false, false],
  ['1080p MULTI SUBS\nSubtitles: Portuguese / English', false, false],
  ['1080p\nLegendas: 🇧🇷 / Português', false, false],
  ['1080p\nSubs / 🇧🇷 / 🇵🇹', false, false],
  ['1080p [Judas] [Dual-Audio][Multi-Subs]\nDubbed / Multi Subs / Dual Audio / 🇬🇧 / 🇵🇹', false, false],
  ['1080p [VARYG] DUAL (Multi-Subs)\nDubbed / Multi Subs / Dual Audio / 🇬🇧 / 🇵🇹', false, false],
  ['1080p\nAudio: English / Japanese\nSubs: PT-BR', false, false],
  ['1080p\nAudio: por / eng', true, false],
  ['1080p Dual Audio Russian / PT-BR', true, false],
  ['1080p DUBLADO', true, false],
  ['1080p MULTI', false, false],
  ['1080p [Multi-Audio]\nAudio: English / French / Spanish\nSubs: Portuguese', false, true],
  ['1080p MULTi AD [Multi Subs Multi Audio]\nDubbed / Multi Audio / Multi Subs / 🇬🇧 / 🇷🇺 / 🇵🇹 / 🇪🇸 / 🇲🇽 / 🇫🇷 / 🇵🇱', true, true],
  ['1080p Multi Audio\nAudio: Portuguese / English / Japanese', true, true],
];
for (const [title, pt, multi] of cases) {
  const parsed = parseStream({ name: 'Torrentio', title });
  assert.equal(parsed.isPtBr, pt, `Portuguese audio: ${title}`);
  assert.equal(parsed.isMultiAudio, multi, `Multiple audio: ${title}`);
  if (multi) assert.equal(parsed.audioBadge.type, 'multi');
}

const witchHat = parseStream({
  name: 'Torrentio\n1080p',
  title: 'Witch Hat Atelier S01 MULTi AD 1080p CR WEB-DL AAC2.0 x264-Tsundere-Raws (VF FRENCH SUBFRENCH VOSTFR Multi Subs Multi Audio Tongari Boushi no Atelier Atelier of Witch Hat)\nWitch Hat Atelier S01E11 MULTi AD 1080p CR WEB-DL AAC2.0 x264-Tsundere-Raws.mkv\n👤 53 💾 1.61 GB ⚙️ NyaaSi\nDubbed / Multi Audio / Multi Subs / 🇬🇧 / 🇷🇺 / 🇵🇹 / 🇪🇸 / 🇲🇽 / 🇫🇷 / 🇵🇱',
});
assert.equal(witchHat.isPtBr, true, 'The actual episode 11 source passes the dubbed filter');
assert.equal(witchHat.audioBadge.type, 'multi');
assert.equal(witchHat.resolution, '1080p');
assert.equal(witchHat.seeds, 53);
assert.equal(witchHat.size, '1.61 GB');
console.log(`Stream parser: ${cases.length + 1} audio/subtitle classification cases passed.`);
