export interface KeyboardCell { colSpan?: number }

export function keyboardDetachmentProgress(progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  const releasePoint = 0.65;
  // Stay anchored through most of the drag, then release quickly and soften the landing.
  if (p <= releasePoint) return 0.06 * (p / releasePoint) ** 4;
  const released = (p - releasePoint) / (1 - releasePoint);
  return 0.06 + 0.94 * (1 - (1 - released) ** 3.2);
}

// Adapted geometry approach from iyinchao/liquid-glass-studio: rounded
// superellipse corners, rather than a concave bridge. See THIRD_PARTY_NOTICES.md.
export function liquidKeyboardPath(width: number, height: number, progress: number, horizontal: boolean, phase = 0) {
  const p = Math.max(0, Math.min(1, progress));
  const envelope = p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p);
  const radius = Math.min(22, width * 0.42, height * 0.42);
  const exponent = 3.2 - envelope * 0.5;
  const points: string[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const variation = 1 + envelope * Math.sin(phase + corner * 1.7 + p * 3.2) * 0.035;
    const r = radius * variation;
    const centerX = corner === 0 || corner === 3 ? width - r : r;
    const centerY = corner < 2 ? height - r : r;
    for (let step = 0; step <= 12; step++) {
      const angle = (corner + step / 12) * Math.PI / 2;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const x = centerX + r * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
      const y = centerY + r * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
      points.push(`${x.toFixed(3)} ${y.toFixed(3)}`);
    }
  }
  // Keep directional variations subtle; the silhouette remains a single convex gel body.
  void horizontal;
  return `M ${points.join(' L ')} Z`;
}

// Damped spring response, mirroring the reference project's spring-driven movement.
export function keyboardGelSpring(timeSeconds: number) {
  const damping = 0.74;
  const frequency = 24;
  const damped = frequency * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * frequency * timeSeconds)
    * (Math.cos(damped * timeSeconds) + damping * frequency / damped * Math.sin(damped * timeSeconds));
}

export class RelativeKeyboardTouchpad {
  private static readonly HORIZONTAL_THRESHOLD = 170;
  private static readonly VERTICAL_THRESHOLD = 95;
  private last: { contactId: number; x: number; y: number } | null = null;
  private horizontal = 0;
  private vertical = 0;
  private liquidPhase = 0;
  private axis: 'horizontal' | 'vertical' | 'diagonal' | null = null;
  private motionTime: number | null = null;
  private speed = 0;

  getMotionStyle(now = performance.now()) {
    const quietTime = this.motionTime === null ? 0 : Math.max(0, now - this.motionTime - 40);
    const speed = this.speed * Math.exp(-quietTime / 110);
    const t = Math.max(0, Math.min(1, (speed - 6) / 8));
    return { speed, deformation: 1 - 0.92 * t * t * (3 - 2 * t), settling: speed > 0.2 };
  }

  getLiquidPhase() { return this.liquidPhase; }

  reset() { this.last = null; this.horizontal = 0; this.vertical = 0; this.axis = null; this.motionTime = null; this.speed = 0; }

  getDragProgress() {
    const x = this.horizontal / RelativeKeyboardTouchpad.HORIZONTAL_THRESHOLD;
    const y = this.vertical / RelativeKeyboardTouchpad.VERTICAL_THRESHOLD;
    if (!this.axis) return { x: 0, y: 0 };
    if (this.axis === 'diagonal') return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    return this.axis === 'horizontal'
      ? { x: Math.max(-1, Math.min(1, x)), y: 0 }
      : { x: 0, y: Math.max(-1, Math.min(1, y)) };
  }

  update(sample: { active: boolean; contactId: number; x: number; y: number }, now = performance.now()) {
    if (!sample.active) { this.reset(); return []; }
    if (!this.last || this.last.contactId !== sample.contactId) {
      this.liquidPhase = Math.random() * Math.PI * 2;
      this.last = sample;
      this.horizontal = 0; this.vertical = 0;
      this.axis = null;
      this.motionTime = now; this.speed = 0;
      return [];
    }
    const dx = (sample.x - this.last.x) * 1920;
    const dy = (sample.y - this.last.y) * 1080;
    const elapsed = Math.max(4, now - (this.motionTime ?? now));
    const previousSpeed = this.getMotionStyle(now).speed;
    const measuredSpeed = Math.max(Math.abs(dx) / RelativeKeyboardTouchpad.HORIZONTAL_THRESHOLD,
      Math.abs(dy) / RelativeKeyboardTouchpad.VERTICAL_THRESHOLD) * 1000 / elapsed;
    const response = measuredSpeed > previousSpeed ? 35 : 110;
    this.speed = previousSpeed + (measuredSpeed - previousSpeed) * (1 - Math.exp(-elapsed / response));
    this.motionTime = now;
    this.horizontal += dx;
    this.vertical += dy;
    this.last = sample;
    const horizontalTravel = Math.abs(this.horizontal) / RelativeKeyboardTouchpad.HORIZONTAL_THRESHOLD;
    const verticalTravel = Math.abs(this.vertical) / RelativeKeyboardTouchpad.VERTICAL_THRESHOLD;
    // Detect the gesture angle in sensor space, independently of axis sensitivity.
    const horizontalDistance = Math.abs(this.horizontal);
    const verticalDistance = Math.abs(this.vertical);
    const ratio = horizontalDistance / verticalDistance;
    // Preserve both components until a destination is committed. A gesture may start
    // on one axis and become diagonal as the next Bluetooth samples arrive.
    const enoughTravel = Math.max(Math.abs(this.horizontal), Math.abs(this.vertical)) >= 20;
    // Enter at 32.5?57.5 degrees; retain diagonal within 30?60 degrees.
    const diagonalExitRange = Math.tan(30 * Math.PI / 180);
    const diagonalRange = this.axis === 'diagonal' ? diagonalExitRange : Math.tan(32.5 * Math.PI / 180);
    const bothMoving = Math.min(horizontalDistance, verticalDistance) >= 12;
    if (enoughTravel && bothMoving && ratio >= diagonalRange && ratio <= 1 / diagonalRange) {
      this.axis = 'diagonal';
    } else if (enoughTravel && (this.axis !== 'diagonal' || ratio < diagonalExitRange || ratio > 1 / diagonalExitRange)) {
      this.axis = horizontalDistance >= verticalDistance ? 'horizontal' : 'vertical';
    }
    const steps: ('left' | 'right' | 'up' | 'down')[] = [];
    // Horizontal changes require more deliberate travel; changing rows is lighter.
    const horizontalThreshold = RelativeKeyboardTouchpad.HORIZONTAL_THRESHOLD;
    const verticalThreshold = RelativeKeyboardTouchpad.VERTICAL_THRESHOLD;
    if (this.axis && (this.axis === 'diagonal' ? Math.max(horizontalTravel, verticalTravel) : this.axis === 'horizontal' ? horizontalTravel : verticalTravel) >= 1) {
      this.liquidPhase += 2.399963;
      if (this.axis === 'diagonal') {
        steps.push(this.vertical > 0 ? 'down' : 'up', this.horizontal > 0 ? 'right' : 'left');
        this.horizontal = 0; this.vertical = 0;
      } else if (this.axis === 'horizontal') {
        steps.push(this.horizontal > 0 ? 'right' : 'left');
        this.horizontal = Math.sign(this.horizontal) * Math.min(Math.abs(this.horizontal) - horizontalThreshold, horizontalThreshold * 0.35);
        this.vertical = 0;
      } else {
        steps.push(this.vertical > 0 ? 'down' : 'up');
        this.vertical = Math.sign(this.vertical) * Math.min(Math.abs(this.vertical) - verticalThreshold, verticalThreshold * 0.35);
        this.horizontal = 0;
      }
    }
    return steps;
  }
}

export class TouchpadActivationGuard {
  private lastTime = -Infinity;
  private lastKey = '';
  allow(key: string, now: number) {
    // Suppress switch bounce and a click followed by an accidental tap on the same key.
    if (now - this.lastTime < 140 || (key === this.lastKey && now - this.lastTime < 280)) return false;
    this.lastTime = now; this.lastKey = key;
    return true;
  }
}

export function moveKeyboardHorizontal(rows: KeyboardCell[][], row: number, col: number, direction: -1 | 1, wrapRows = true) {
  if (!wrapRows) return { row, col: Math.max(0, Math.min(rows[row].length - 1, col + direction)) };
  if (direction === 1) {
    if (col < rows[row].length - 1) return { row, col: col + 1 };
    const nextRow = (row + 1) % rows.length;
    return { row: nextRow, col: 0 };
  }
  if (col > 0) return { row, col: col - 1 };
  const previousRow = (row - 1 + rows.length) % rows.length;
  return { row: previousRow, col: rows[previousRow].length - 1 };
}

export function moveKeyboardVertical(rows: KeyboardCell[][], row: number, col: number, direction: -1 | 1,
  measure?: (row: number, col: number) => { left: number; width: number } | undefined) {
  const nextRow = Math.max(0, Math.min(rows.length - 1, row + direction));
  if (nextRow === row) return { row, col };
  const bounds = (r: number, c: number) => {
    const measured = measure?.(r, c);
    if (measured) return measured;
    const total = rows[r].reduce((sum, cell) => sum + (cell.colSpan || 1), 0);
    const left = rows[r].slice(0, c).reduce((sum, cell) => sum + (cell.colSpan || 1), 0) / total;
    return { left, width: (rows[r][c].colSpan || 1) / total };
  };
  const source = bounds(row, col);
  const x = source.left + source.width / 2;
  let nearest = 0;
  let distance = Infinity;
  for (let c = 0; c < rows[nextRow].length; c++) {
    const target = bounds(nextRow, c);
    if (x >= target.left && x < target.left + target.width) return { row: nextRow, col: c };
    const delta = Math.abs(x - target.left - target.width / 2);
    if (delta < distance) { distance = delta; nearest = c; }
  }
  return { row: nextRow, col: nearest };
}

