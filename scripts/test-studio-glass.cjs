const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/studioGlass.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { studioGlassDistance: distance, studioGlassOptics: optics } = exportsObject;
assert.ok(distance(100, 50, 200, 100, 20) < 0, 'The center stays inside the glass');
assert.equal(distance(0, 50, 200, 100, 20), 0, 'The physical edge defines the rim');
assert.ok(distance(0, 0, 200, 100, 20) > 0, 'Rounded corners exclude the outside background');
assert.equal(optics(-40, 1, 0, 18).x, 0, 'Interior content stays undistorted');
assert.equal(optics(1, 1, 0, 18).rim, 0, 'No highlights outside the glass');
assert.ok(optics(-1, 1, 0, 18).x > optics(-12, 1, 0, 18).x, 'Snell refraction concentrates toward the bezel');
assert.ok(optics(-1, 1, 0, 18).rim > optics(-12, 1, 0, 18).rim, 'Fresnel reflection fades toward the center');
assert.equal(optics(-2, 1, 0, 18).x, -optics(-2, -1, 0, 18).x, 'Opposite edges refract in opposite directions');
assert.ok(optics(-1, Math.SQRT1_2, -Math.SQRT1_2, 18).rim > optics(-1, Math.SQRT1_2, Math.SQRT1_2, 18).rim * 3,
  'Glare follows the lighting angle rather than forming a uniform white outline');
assert.ok(optics(-9, 1, 0, 18).rim < 0.001 && optics(-9, 1, 0, 18).x > 0,
  'The refracting bevel remains transparent beyond the narrow reflection');
for (let depth = 0; depth <= 20; depth += .25) {
  const result = optics(-depth, Math.SQRT1_2, -Math.SQRT1_2, 18);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
  assert.ok(result.rim >= 0 && result.rim <= 1);
}
console.log('Studio optics passed: shape boundaries, Snell refraction, Fresnel falloff and finite diagonal normals.');
