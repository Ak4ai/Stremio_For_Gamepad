import { liquidKeyboardPath } from './keyboardNavigation';

interface GelRect { left: number; top: number; width: number; height: number }

// Rounded SDF and polynomial smooth union adapted from Liquid Glass Studio's
// src/shaders/lib/sdf.glsl (MIT, Charles Yin). See THIRD_PARTY_NOTICES.md.
function roundedDistance(x: number, y: number, rect: GelRect) {
  const radius = Math.min(22, rect.width * 0.42, rect.height * 0.42);
  const qx = Math.abs(x - rect.left - rect.width / 2) - rect.width / 2 + radius;
  const qy = Math.abs(y - rect.top - rect.height / 2) - rect.height / 2 + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

export function smoothGelUnion(a: number, b: number, mergeRate: number) {
  const k = Math.max(0.001, mergeRate);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

export function mergedKeyboardGel(from: GelRect, to: GelRect, progress: number, mergeRate = 0.85, deformation = 1) {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0.01 || p >= 0.99) {
    const rect = p <= 0.01 ? from : to;
    return { ...rect, path: liquidKeyboardPath(rect.width, rect.height, 0, true) };
  }
  const ax = from.left + from.width / 2, ay = from.top + from.height / 2;
  const bx = to.left + to.width / 2, by = to.top + to.height / 2;
  const dx = bx - ax, dy = by - ay;
  const blob = (cx: number, cy: number, rect: GelRect, amount: number): GelRect => {
    const scale = Math.sqrt(amount);
    const width = rect.width * scale, height = rect.height * scale;
    return { left: cx - width / 2, top: cy - height / 2, width, height };
  };
  const emergence = (amount: number) => {
    const t = Math.min(1, amount / 0.35);
    return t * t * (3 - 2 * t);
  };
  // The new lobe starts inside the current bubble and gently separates. Spawning
  // a tiny lobe near the destination immediately would pull out a pointed tip.
  const firstTravel = p * (1 - 0.82 * emergence(1 - p));
  const secondTravel = p + (1 - p) * 0.82 * emergence(p);
  const first = blob(ax + dx * firstTravel, ay + dy * firstTravel, from, 1 - p);
  const second = blob(ax + dx * secondTravel, ay + dy * secondTravel, to, p);
  const centerX = ax + dx * p, centerY = ay + dy * p;
  const intensity = Math.max(0, Math.min(1, deformation));
  const whole = { left: from.left + (to.left - from.left) * p, top: from.top + (to.top - from.top) * p,
    width: from.width + (to.width - from.width) * p, height: from.height + (to.height - from.height) * p };
  if (intensity <= 0.001) return { ...whole, path: liquidKeyboardPath(whole.width, whole.height, 0, true) };
  let merge = Math.min(from.width, from.height, to.width, to.height) * mergeRate * (0.25 + 0.75 * Math.sin(Math.PI * p))
    + Math.hypot(dx, dy) * Math.sin(Math.PI * p) * 0.18;
  const union = (x: number, y: number) => smoothGelUnion(roundedDistance(x, y, first), roundedDistance(x, y, second), merge);
  const field = (x: number, y: number) => union(x, y) * intensity + roundedDistance(x, y, whole) * (1 - intensity);
  // Keep the two lobes joined, including diagonals and differently sized action keys.
  for (let i = 0; i < 8 && union(centerX, centerY) > -0.5; i++) merge *= 1.4;
  const margin = merge / 2 + 8;
  const gridLeft = Math.min(first.left, second.left, whole.left) - margin;
  const gridTop = Math.min(first.top, second.top, whole.top) - margin;
  const extentX = Math.max(first.left + first.width, second.left + second.width, whole.left + whole.width) - gridLeft + margin;
  const extentY = Math.max(first.top + first.height, second.top + second.height, whole.top + whole.height) - gridTop + margin;
  const cellSize = Math.max(extentX, extentY) / 72;
  const columns = Math.ceil(extentX / cellSize), rows = Math.ceil(extentY / cellSize);
  const values = new Float64Array((columns + 1) * (rows + 1));
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    values[y * (columns + 1) + x] = field(gridLeft + x * cellSize, gridTop + y * cellSize);
  }
  const nodes = new Map<string, { point: [number, number]; neighbors: string[] }>();
  const connect = (a: string, b: string) => { nodes.get(a)!.neighbors.push(b); nodes.get(b)!.neighbors.push(a); };
  // Marching squares retains the actual smooth-union contour, including concave
  // joins. Radial outlines would incorrectly straighten diagonal connections.
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const samples = [values[y * (columns + 1) + x], values[y * (columns + 1) + x + 1], values[(y + 1) * (columns + 1) + x + 1], values[(y + 1) * (columns + 1) + x]];
    const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const names = [`h:${x}:${y}`, `v:${x + 1}:${y}`, `h:${x}:${y + 1}`, `v:${x}:${y}`];
    const edges: string[] = [];
    let mask = 0;
    for (let edge = 0; edge < 4; edge++) {
      if (samples[edge] < 0) mask |= 1 << edge;
      const next = (edge + 1) % 4;
      if ((samples[edge] < 0) === (samples[next] < 0)) continue;
      const name = names[edge];
      if (!nodes.has(name)) {
        const t = samples[edge] / (samples[edge] - samples[next]);
        nodes.set(name, { point: [gridLeft + (corners[edge][0] + (corners[next][0] - corners[edge][0]) * t) * cellSize,
          gridTop + (corners[edge][1] + (corners[next][1] - corners[edge][1]) * t) * cellSize], neighbors: [] });
      }
      edges.push(name);
    }
    if (edges.length === 2) connect(edges[0], edges[1]);
    else if (edges.length === 4) {
      const inside = field(gridLeft + (x + 0.5) * cellSize, gridTop + (y + 0.5) * cellSize) < 0;
      if ((mask === 5) === inside) { connect(edges[0], edges[1]); connect(edges[2], edges[3]); }
      else { connect(edges[0], edges[3]); connect(edges[1], edges[2]); }
    }
  }
  const visited = new Set<string>();
  const loops: [number, number][][] = [];
  for (const start of nodes.keys()) {
    if (visited.has(start)) continue;
    const loop: [number, number][] = [];
    let current = start, previous = '';
    while (!visited.has(current)) {
      visited.add(current);
      const node = nodes.get(current)!;
      loop.push(node.point);
      const next = node.neighbors.find((name) => name !== previous);
      if (!next) break;
      previous = current; current = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  const area = (loop: [number, number][]) => Math.abs(loop.reduce((sum, [x, y], i) => {
    const next = loop[(i + 1) % loop.length]; return sum + x * next[1] - y * next[0];
  }, 0));
  loops.sort((a, b) => area(b) - area(a));
  const points = loops[0];
  if (!points) return { ...from, path: liquidKeyboardPath(from.width, from.height, 0, true) };
  const left = Math.min(...points.map(([x]) => x)), top = Math.min(...points.map(([, y]) => y));
  const width = Math.max(...points.map(([x]) => x)) - left, height = Math.max(...points.map(([, y]) => y)) - top;
  return { left, top, width, height,
    path: `M ${points.map(([x, y]) => `${(x - left).toFixed(3)} ${(y - top).toFixed(3)}`).join(' L ')} Z` };
}
