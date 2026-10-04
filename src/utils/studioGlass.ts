// CPU map adapter for Liquid Glass Studio's roundedRectSDF, Snell refraction,
// fifth-power Fresnel and directional glare (MIT, Charles Yin). An SVG backdrop
// filter samples the live DOM instead of requiring a captured WebGL texture.
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const cache = new Map<string, { displacement: string; rim: string }>();

export function studioGlassDistance(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  const dx = Math.abs(x - width / 2) - width / 2;
  const dy = Math.abs(y - height / 2) - height / 2;
  if (r > 0 && dx > -r && dy > -r) {
    return ((dx + r) ** 4 + (dy + r) ** 4) ** 0.25 - r;
  }
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

export function studioGlassOptics(distance: number, normalX: number, normalY: number, thickness: number) {
  const depth = Math.max(0, -distance);
  if (distance > 0 || depth >= thickness) return { x: 0, y: 0, rim: 0, r: 255, g: 255, b: 255 };
  const ratio = clamp(1 - depth / thickness);
  const incident = Math.asin(ratio ** 2);
  const transmitted = Math.asin(Math.sin(incident) / 1.45);
  const refraction = Math.min(1.2, -Math.tan(transmitted - incident));
  // Separate the optical bevel from the much narrower reflection, as in
  // Studio's final shader. A broad white rim makes the lens look opaque.
  const fresnel = clamp(1 - depth / (thickness * 0.62)) ** 5;
  const glare = clamp(1 - depth / (thickness * 0.45)) ** 5;
  const angle = Math.atan2(normalY, normalX);
  const directionalGlare = (0.5 + 0.5 * Math.cos(2 * (angle + Math.PI / 4))) ** 1.1;
  const oppositeSide = normalX + normalY > 0 ? 0.8 : 1;
  const rim = clamp(fresnel * 0.14 + glare * directionalGlare * oppositeSide * 0.86);

  // Prismatic dispersion on the bevel edge:
  // Outer rim has warm golden/amber tones, peak glare is pure white,
  // and inner refraction bevel carries a subtle cyan/blue tint.
  const bevel = depth / thickness;
  let r = 255, g = 255, b = 255;
  if (bevel < 0.28) {
    r = 255;
    g = Math.round(234 + 21 * directionalGlare);
    b = Math.round(214 + 41 * directionalGlare);
  } else {
    const t = (bevel - 0.28) / 0.72;
    r = Math.round(255 - 55 * t);
    g = Math.round(255 - 18 * t);
    b = 255;
  }

  return { x: normalX * refraction, y: normalY * refraction, rim, r, g, b };
}

export function createStudioGlassMaps(width: number, height: number, radius: number) {
  const key = `${width}:${height}:${radius}`;
  const saved = cache.get(key);
  if (saved) return saved;
  // Supersample small controls to keep their optical edges smooth on HiDPI.
  const scale = Math.min(2, 768 / width, 384 / height);
  const w = Math.max(2, Math.ceil(width * scale)), h = Math.max(2, Math.ceil(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d')!;
  const displacement = context.createImageData(w, h), rim = context.createImageData(w, h);
  const thickness = Math.min(18, Math.max(7, Math.min(width, height) * 0.23));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x + 0.5) * width / w, py = (y + 0.5) * height / h;
    const distance = studioGlassDistance(px, py, width, height, radius);
    const nx = studioGlassDistance(px + 0.5, py, width, height, radius) - studioGlassDistance(px - 0.5, py, width, height, radius);
    const ny = studioGlassDistance(px, py + 0.5, width, height, radius) - studioGlassDistance(px, py - 0.5, width, height, radius);
    const length = Math.hypot(nx, ny) || 1;
    const optics = studioGlassOptics(distance, nx / length, ny / length, thickness);
    const i = (y * w + x) * 4;
    displacement.data[i] = Math.round(clamp(0.5 + optics.x * 0.36) * 255);
    displacement.data[i + 1] = Math.round(clamp(0.5 + optics.y * 0.36) * 255);
    displacement.data[i + 2] = 128;
    displacement.data[i + 3] = 255;
    rim.data[i] = optics.r;
    rim.data[i + 1] = optics.g;
    rim.data[i + 2] = optics.b;
    const coverage = clamp(0.5 - distance * scale);
    rim.data[i + 3] = Math.round(optics.rim * coverage * 255);
  }
  context.putImageData(displacement, 0, 0);
  const displacementUrl = canvas.toDataURL();
  context.putImageData(rim, 0, 0);
  const maps = { displacement: displacementUrl, rim: canvas.toDataURL() };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, maps);
  return maps;
}
