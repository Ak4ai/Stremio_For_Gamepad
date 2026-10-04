// Xelu/Haaldor's CC0 vector source, isolated into reproducible Deck prompts.
// Source: https://github.com/haaldor/Xelu_prompts_SVG/blob/main/Vector%20Source.svg
const fs = require('node:fs');
const path = require('node:path');
const assets = require('./assets/xelu-steam-deck.json');
const destination = path.resolve(__dirname, '../src/assets/prompts/steam-deck');
fs.mkdirSync(destination, { recursive: true });
for (const [button, source] of Object.entries(assets)) {
  // Keep the original vector artwork; use a system font for the editable labels.
  const svg = source.replace(/font-family:[^;"]+/gi, 'font-family:Arial,sans-serif');
  fs.writeFileSync(path.join(destination, `${button.toLowerCase()}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Steam Deck ${button}</title>${svg}</svg>\n`);
}
console.log(`Exported ${Object.keys(assets).length} Steam Deck SVG prompts from Xelu/Haaldor.`);
