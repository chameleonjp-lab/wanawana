import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  DEFAULT_TRAP_LOADOUT,
  type InputCommand,
  type ObstacleCell,
  type PlayerState,
  type TrapLoadout,
  type TrapDirection,
  type TrapKind,
} from './types.ts';

export const PLAYER_SPEED_UNITS_PER_TICK = 512;
export const PLAYER_SLOWED_SPEED_UNITS_PER_TICK = 307;
export const PLAYER_RADIUS_UNITS = 3_072;
export const SHOT_SPEED_UNITS_PER_TICK = 1_600;
export const SHOT_DIAGONAL_SPEED_UNITS_PER_TICK = 1_131;
export const SHOT_PUSH_UNITS = 3_840;
export const SHOT_RADIUS_UNITS = 512;
export const SHOT_RANGE_UNITS = 7 * CELL_UNITS;
export const FIRE_COOLDOWN_TICKS = 39;
export const FIRE_SLOW_TICKS = 9;
export const PUSH_IMMUNITY_TICKS = 24;
export const INVESTIGATION_PAUSE_TICKS = 12;
export const GEAR_MAX = 5;
export const GEAR_START = 3;
export const GEAR_RECOVERY_TICKS = 360;
export const MAX_ACTIVE_TRAPS = 4;
export const TRAP_PLACEMENT_TICKS = 18;
export const TRAP_ARMING_TICKS = 36;
export const TRAP_LIFETIME_TICKS = 1_800;
export const TRAP_COOLDOWN_TICKS = 21;
export const INVESTIGATE_TICKS = 39;
export const DISARM_TICKS = 54;
export const INVESTIGATE_RADIUS_UNITS = Math.trunc(1.6 * CELL_UNITS);
export const DISARM_RADIUS_UNITS = Math.trunc(0.8 * CELL_UNITS);
export const BOUNCE_PUSH_UNITS = Math.trunc(2.25 * CELL_UNITS);
export const SHOCK_RADIUS_UNITS = Math.trunc(0.55 * CELL_UNITS);
export const SHOCK_PUSH_UNITS = Math.trunc(0.6 * CELL_UNITS);
export const HATCH_RADIUS_UNITS = Math.trunc(0.45 * CELL_UNITS);
export const HATCH_DISABLED_TICKS = 48;
/** Pon玉 arms on contact, then explodes after 0.75 seconds (45 fixed ticks). */
export const BOMB_TRIGGER_TICKS = 45;
export const BOMB_RADIUS_UNITS = Math.trunc(1.4 * CELL_UNITS);
/** A bomb blast primes other armed bombs within the same 1.4-cell radius. */
export const BOMB_CHAIN_RADIUS_UNITS = BOMB_RADIUS_UNITS;
export const BOMB_CONTACT_RADIUS_UNITS = Math.trunc(0.7 * CELL_UNITS);
export const BOMB_DAMAGE = 20;
export const BOMB_PUSH_UNITS = Math.trunc(0.6 * CELL_UNITS);
/** モヤびん slows movement inside a 1.5-cell gas field for 3.5 seconds. */
export const MOYA_CONTACT_RADIUS_UNITS = Math.trunc(0.6 * CELL_UNITS);
export const MOYA_RADIUS_UNITS = Math.trunc(1.5 * CELL_UNITS);
export const MOYA_EFFECT_TICKS = 210;
export const MOYA_SLOWED_SPEED_UNITS_PER_TICK = Math.trunc(PLAYER_SPEED_UNITS_PER_TICK * 0.7);
export const RESPAWN_INVULNERABLE_TICKS = 30;
export const MAX_CHAIN_TRAPS = 8;
export const MAX_EVENTS_PER_TICK = 128;
export const MAX_EVENT_LOG = 50_000;
/** Retained for replay/config compatibility; swept collision does not probe a grid. */
export const COLLISION_SEARCH_STEP_UNITS = 512;

export const TRAP_COSTS: Readonly<Record<TrapKind, number>> = {
  bounce: 1,
  shock: 2,
  hatch: 2,
  bomb: 2,
  moya: 1,
};
export const TRAP_LOADOUT_CHOICES: readonly TrapKind[] = ['shock', 'hatch', 'bomb', 'moya'];

const MIN_X = PLAYER_RADIUS_UNITS;
const MIN_Y = PLAYER_RADIUS_UNITS;
const MAX_X = ARENA_WIDTH_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;
const MAX_Y = ARENA_HEIGHT_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function circleIntersectsObstacle(
  x: number,
  y: number,
  radius: number,
  obstacles: readonly ObstacleCell[],
): boolean {
  return obstacles.some((obstacle) => {
    const left = obstacle.cellX * CELL_UNITS;
    const right = (obstacle.cellX + 1) * CELL_UNITS;
    const top = obstacle.cellY * CELL_UNITS;
    const bottom = (obstacle.cellY + 1) * CELL_UNITS;
    const nearestX = clampInteger(x, left, right);
    const nearestY = clampInteger(y, top, bottom);
    const dx = x - nearestX;
    const dy = y - nearestY;
    return dx * dx + dy * dy <= radius * radius;
  });
}

interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface SegmentParameterInterval {
  readonly entry: Rational;
  readonly exit: Rational;
}

const ZERO_RATIONAL: Rational = { numerator: 0n, denominator: 1n };
const ONE_RATIONAL: Rational = { numerator: 1n, denominator: 1n };

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new Error('A collision parameter cannot have a zero denominator.');
  return denominator < 0n
    ? { numerator: -numerator, denominator: -denominator }
    : { numerator, denominator };
}

function compareRational(first: Rational, second: Rational): number {
  const left = first.numerator * second.denominator;
  const right = second.numerator * first.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

function maxRational(first: Rational, second: Rational): Rational {
  return compareRational(first, second) >= 0 ? first : second;
}

function minRational(first: Rational, second: Rational): Rational {
  return compareRational(first, second) <= 0 ? first : second;
}

function clampRational(value: Rational, minimum: Rational, maximum: Rational): Rational {
  return minRational(maximum, maxRational(minimum, value));
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('The square root input must be non-negative.');
  if (value < 2n) return value;

  let low = 1n;
  let high = 2n;
  while (high * high <= value) high *= 2n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (middle * middle <= value) low = middle;
    else high = middle;
  }
  return low;
}

function ceilIntegerSquareRoot(value: bigint): bigint {
  const floor = integerSqrt(value);
  return floor * floor === value ? floor : floor + 1n;
}

/**
 * Intersect a parametric segment S + D*t, 0 <= t <= 1, with an AABB.
 * The bounds are rational so no floating point time or tie-break is involved.
 */
function segmentIntersectsRectangle(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): SegmentParameterInterval | null {
  let entry = ZERO_RATIONAL;
  let exit = ONE_RATIONAL;
  const axes: readonly [number, number, number, number][] = [
    [startX, deltaX, left, right],
    [startY, deltaY, top, bottom],
  ];

  for (const [start, delta, minimum, maximum] of axes) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return null;
      continue;
    }

    const first = rational(BigInt(minimum - start), BigInt(delta));
    const second = rational(BigInt(maximum - start), BigInt(delta));
    entry = maxRational(entry, minRational(first, second));
    exit = minRational(exit, maxRational(first, second));
    if (compareRational(entry, exit) > 0) return null;
  }

  return { entry, exit };
}

/**
 * Intersect a parametric segment with a circle. The circle's roots can be
 * irrational; integer square-root bounds provide a deterministic lower bound
 * for the first contact while preserving the integer state contract.
 */
function segmentIntersectsCircle(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  centerX: number,
  centerY: number,
  radius: number,
): SegmentParameterInterval | null {
  const endX = startX + deltaX;
  const endY = startY + deltaY;
  if (!segmentHitsCircle(startX, startY, endX, endY, centerX, centerY, radius)) return null;

  const relativeX = BigInt(startX - centerX);
  const relativeY = BigInt(startY - centerY);
  const velocityX = BigInt(deltaX);
  const velocityY = BigInt(deltaY);
  const a = velocityX * velocityX + velocityY * velocityY;
  const c = relativeX * relativeX + relativeY * relativeY - BigInt(radius) * BigInt(radius);
  if (a === 0n) return { entry: ZERO_RATIONAL, exit: ONE_RATIONAL };
  if (c <= 0n) {
    // The caller handles a starting overlap/tangent separately. Returning a
    // zero entry keeps this interval useful for a segment that starts on the
    // boundary and immediately moves into the obstacle.
    return { entry: ZERO_RATIONAL, exit: ONE_RATIONAL };
  }

  const b = 2n * (relativeX * velocityX + relativeY * velocityY);
  const discriminant = b * b - 4n * a * c;
  if (discriminant < 0n) return null;
  const ceilRoot = ceilIntegerSquareRoot(discriminant);
  const denominator = 2n * a;
  // (-b - ceil(sqrt(disc))) / (2a) is no later than the exact first root.
  const entryLowerBound = rational(-b - ceilRoot, denominator);
  const exitUpperBound = rational(-b + ceilRoot, denominator);
  if (compareRational(exitUpperBound, ZERO_RATIONAL) < 0
    || compareRational(entryLowerBound, ONE_RATIONAL) > 0) return null;
  return {
    entry: clampRational(entryLowerBound, ZERO_RATIONAL, ONE_RATIONAL),
    exit: clampRational(exitUpperBound, ZERO_RATIONAL, ONE_RATIONAL),
  };
}

function obstacleFeatureIntervals(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  obstacle: ObstacleCell,
  radius: number,
): readonly SegmentParameterInterval[] {
  const left = obstacle.cellX * CELL_UNITS;
  const right = (obstacle.cellX + 1) * CELL_UNITS;
  const top = obstacle.cellY * CELL_UNITS;
  const bottom = (obstacle.cellY + 1) * CELL_UNITS;
  const intervals: SegmentParameterInterval[] = [];

  // The Minkowski sum of a rectangle and a circle is the union of its two
  // expanded strips and four corner circles. Using this shape avoids the
  // square-corner false positives of padding an AABB by the radius.
  const horizontalStrip = segmentIntersectsRectangle(
    startX,
    startY,
    deltaX,
    deltaY,
    left,
    right,
    top - radius,
    bottom + radius,
  );
  if (horizontalStrip) intervals.push(horizontalStrip);

  const verticalStrip = segmentIntersectsRectangle(
    startX,
    startY,
    deltaX,
    deltaY,
    left - radius,
    right + radius,
    top,
    bottom,
  );
  if (verticalStrip) intervals.push(verticalStrip);

  for (const [centerX, centerY] of [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ] as const) {
    const corner = segmentIntersectsCircle(
      startX,
      startY,
      deltaX,
      deltaY,
      centerX,
      centerY,
      radius,
    );
    if (corner) intervals.push(corner);
  }
  return intervals;
}

function startsMovingIntoObstacle(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  obstacle: ObstacleCell,
  radius: number,
): boolean {
  const left = obstacle.cellX * CELL_UNITS;
  const right = (obstacle.cellX + 1) * CELL_UNITS;
  const top = obstacle.cellY * CELL_UNITS;
  const bottom = (obstacle.cellY + 1) * CELL_UNITS;
  const nearestX = clampInteger(x, left, right);
  const nearestY = clampInteger(y, top, bottom);
  const offsetX = x - nearestX;
  const offsetY = y - nearestY;
  const distanceSquared = offsetX * offsetX + offsetY * offsetY;
  const radiusSquared = radius * radius;

  // A strictly overlapping state is invalid, so hold it in place rather than
  // allowing one movement to emerge through a wall.
  if (distanceSquared < radiusSquared) return true;
  if (distanceSquared > radiusSquared) return false;

  const directionDot = offsetX * deltaX + offsetY * deltaY;
  if (directionDot < 0) return true;
  if (directionDot > 0) return false;
  // A tangent line does not enter the obstacle. It may stay in contact with a
  // side while sliding, or leave a corner immediately; both are safe. The
  // strict inward case was handled by directionDot < 0 above.
  return false;
}

function firstContactForObstacle(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  obstacle: ObstacleCell,
  radius: number,
): Rational | null {
  const startCollides = circleIntersectsObstacle(startX, startY, radius, [obstacle]);
  if (startCollides) {
    if (deltaX === 0 && deltaY === 0) return ZERO_RATIONAL;
    // Permit a tangent player to move away from a boundary or slide alongside
    // it. This avoids a permanent one-unit overlap/touch stack while still
    // stopping movement that goes into a wall.
    if (!startsMovingIntoObstacle(startX, startY, deltaX, deltaY, obstacle, radius)) return null;
    return ZERO_RATIONAL;
  }

  let first: Rational | null = null;
  for (const interval of obstacleFeatureIntervals(startX, startY, deltaX, deltaY, obstacle, radius)) {
    if (compareRational(interval.exit, ZERO_RATIONAL) < 0
      || compareRational(interval.entry, ONE_RATIONAL) > 0) continue;
    const entry = clampRational(interval.entry, ZERO_RATIONAL, ONE_RATIONAL);
    if (!first || compareRational(entry, first) < 0) first = entry;
  }
  return first;
}

function firstSweptContact(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  obstacles: readonly ObstacleCell[],
  radius: number,
): Rational | null {
  let first: Rational | null = null;
  for (const obstacle of obstacles) {
    const left = obstacle.cellX * CELL_UNITS - radius;
    const right = (obstacle.cellX + 1) * CELL_UNITS + radius;
    const top = obstacle.cellY * CELL_UNITS - radius;
    const bottom = (obstacle.cellY + 1) * CELL_UNITS + radius;
    // This is only a broad-phase exclusion. The actual test below still uses
    // the rounded Minkowski shape, so a square expanded corner can never cause
    // a collision by itself.
    if (Math.max(startX, startX + deltaX) < left
      || Math.min(startX, startX + deltaX) > right
      || Math.max(startY, startY + deltaY) < top
      || Math.min(startY, startY + deltaY) > bottom) continue;
    const candidate = firstContactForObstacle(startX, startY, deltaX, deltaY, obstacle, radius);
    if (candidate && (!first || compareRational(candidate, first) < 0)) first = candidate;
  }
  return first;
}

function firstArenaBoundaryContact(
  start: number,
  delta: number,
  minimum: number,
  maximum: number,
): Rational | null {
  if (delta > 0 && start + delta >= maximum) return rational(BigInt(maximum - start), BigInt(delta));
  if (delta < 0 && start + delta <= minimum) return rational(BigInt(minimum - start), BigInt(delta));
  return null;
}

function earliestArenaBoundaryContact(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
): Rational | null {
  const candidates = [
    firstArenaBoundaryContact(startX, deltaX, MIN_X, MAX_X),
    firstArenaBoundaryContact(startY, deltaY, MIN_Y, MAX_Y),
  ].filter((candidate): candidate is Rational => candidate !== null);
  let first: Rational | null = null;
  for (const candidate of candidates) {
    if (compareRational(candidate, ZERO_RATIONAL) < 0
      || compareRational(candidate, ONE_RATIONAL) > 0) continue;
    if (!first || compareRational(candidate, first) < 0) first = candidate;
  }
  return first;
}

function ceilProgress(value: Rational, steps: number): number {
  const product = value.numerator * BigInt(steps);
  if (product >= 0n) return Number((product + value.denominator - 1n) / value.denominator);
  return -Number((-product) / value.denominator);
}

function pointAtProgress(
  startX: number,
  startY: number,
  deltaX: number,
  deltaY: number,
  progress: number,
  steps: number,
): { x: number; y: number } {
  if (steps === 0) return { x: startX, y: startY };
  return {
    x: startX + Math.trunc(deltaX * progress / steps),
    y: startY + Math.trunc(deltaY * progress / steps),
  };
}

export function movePlayerWithObstacles(
  player: PlayerState,
  deltaXInput: number,
  deltaYInput: number,
  obstacles: readonly ObstacleCell[] = [],
): PlayerState {
  const startX = clampInteger(player.x, MIN_X, MAX_X);
  const startY = clampInteger(player.y, MIN_Y, MAX_Y);
  const deltaX = Number.isFinite(deltaXInput) ? Math.trunc(deltaXInput) : 0;
  const deltaY = Number.isFinite(deltaYInput) ? Math.trunc(deltaYInput) : 0;
  const targetX = clampInteger(startX + deltaX, MIN_X, MAX_X);
  const targetY = clampInteger(startY + deltaY, MIN_Y, MAX_Y);
  if (deltaX === 0 && deltaY === 0) {
    return { ...player, x: targetX, y: targetY };
  }

  // Keep the requested segment intact until its first collision. Clamping X
  // and Y independently before sweeping would silently turn a diagonal move
  // into a different direction when only one axis reaches the arena edge.
  const boundaryContact = earliestArenaBoundaryContact(startX, startY, deltaX, deltaY);
  const contact = firstSweptContact(
    startX,
    startY,
    deltaX,
    deltaY,
    obstacles,
    PLAYER_RADIUS_UNITS,
  );
  const boundaryIsFirst = boundaryContact !== null
    && (contact === null || compareRational(boundaryContact, contact) <= 0);
  if (boundaryContact === null && contact === null) {
    return { ...player, x: targetX, y: targetY };
  }

  // Contact itself is treated as occupied by circleIntersectsObstacle. Move
  // to the last integer point before it, preserving one direct segment rather
  // than resolving X and Y as an implicit L-shaped route.
  const firstContact = boundaryIsFirst ? boundaryContact : contact;
  if (!firstContact) return { ...player, x: targetX, y: targetY };
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  let safeProgress = Math.max(
    0,
    Math.min(steps, ceilProgress(firstContact, steps) - (boundaryIsFirst ? 0 : 1)),
  );
  let safePoint = pointAtProgress(startX, startY, deltaX, deltaY, safeProgress, steps);
  if (boundaryIsFirst) {
    safePoint = {
      x: clampInteger(safePoint.x, MIN_X, MAX_X),
      y: clampInteger(safePoint.y, MIN_Y, MAX_Y),
    };
  }

  // Integer interpolation can move a rounded corner by one unit relative to
  // the continuous contact bound. Re-sweep the quantized segment and retreat
  // until the entire stored segment is clear, rather than checking its end
  // point only. This also covers diagonal corner grazing symmetrically.
  while (
    safeProgress > 0
    && (
      circleIntersectsObstacle(safePoint.x, safePoint.y, PLAYER_RADIUS_UNITS, obstacles)
      || firstSweptContact(
        startX,
        startY,
        safePoint.x - startX,
        safePoint.y - startY,
        obstacles,
        PLAYER_RADIUS_UNITS,
      ) !== null
    )
  ) {
    safeProgress -= 1;
    safePoint = pointAtProgress(startX, startY, deltaX, deltaY, safeProgress, steps);
    if (boundaryIsFirst) {
      safePoint = {
        x: clampInteger(safePoint.x, MIN_X, MAX_X),
        y: clampInteger(safePoint.y, MIN_Y, MAX_Y),
      };
    }
  }
  return { ...player, x: safePoint.x, y: safePoint.y };
}

export function applyMovement(
  player: PlayerState,
  command: InputCommand,
  obstacles: readonly ObstacleCell[] = [],
): PlayerState {
  const speed = player.fireSlowTicks > 0
    ? PLAYER_SLOWED_SPEED_UNITS_PER_TICK
    : player.gasSlowTicks > 0
      ? MOYA_SLOWED_SPEED_UNITS_PER_TICK
      : PLAYER_SPEED_UNITS_PER_TICK;
  return movePlayerWithObstacles(player, command.moveX * speed, command.moveY * speed, obstacles);
}

export function normalizeAxis(value: number): -1 | 0 | 1 {
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}

export function normalizeCommand(command: Partial<InputCommand>): InputCommand {
  return {
    moveX: normalizeAxis(command.moveX ?? 0),
    moveY: normalizeAxis(command.moveY ?? 0),
    fire: command.fire === true,
    placeTrap: command.placeTrap,
    trapDirection: normalizeDirection(command.trapDirection),
    trapCellX: Number.isInteger(command.trapCellX) ? command.trapCellX : undefined,
    trapCellY: Number.isInteger(command.trapCellY) ? command.trapCellY : undefined,
    investigate: command.investigate === true,
    investigateStart: command.investigateStart === true,
  };
}

export function normalizeDirection(value: number | undefined): TrapDirection {
  if (value === 1 || value === 2 || value === 3) return value;
  return 0;
}

export function isTrapKind(value: string | undefined): value is TrapKind {
  return value === 'bounce' || value === 'shock' || value === 'hatch' || value === 'bomb' || value === 'moya';
}

export function normalizeTrapLoadout(loadout: readonly TrapKind[] | undefined): TrapLoadout {
  const selected = new Set<TrapKind>(loadout ?? []);
  selected.add('bounce');
  const result: TrapKind[] = ['bounce'];
  for (const kind of TRAP_LOADOUT_CHOICES) {
    if (result.length >= 3) break;
    if (selected.has(kind)) result.push(kind);
  }
  for (const kind of DEFAULT_TRAP_LOADOUT) {
    if (result.length >= 3) break;
    if (!result.includes(kind)) result.push(kind);
  }
  return result as unknown as TrapLoadout;
}

export function snapToCell(value: number, maximumCells: number): number {
  // Positions are represented in the centre of each cell. Convert to the
  // nearest integer cell index before clamping to the arena.
  return clampInteger(Math.round(value / CELL_UNITS - 0.5), 0, maximumCells - 1);
}

export function cellCenterUnits(cell: number): number {
  return (cell + 0.5) * CELL_UNITS;
}

export function cellToPixels(value: number, pixelsPerCell: number): number {
  return (value / CELL_UNITS) * pixelsPerCell;
}

export function autoAimVelocity(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): { vx: number; vy: number } {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const signX = dx < 0 ? -1 : 1;
  const signY = dy < 0 ? -1 : 1;

  if (absX === 0 && absY === 0) return { vx: SHOT_SPEED_UNITS_PER_TICK, vy: 0 };
  if (absX >= absY * 2) return { vx: signX * SHOT_SPEED_UNITS_PER_TICK, vy: 0 };
  if (absY >= absX * 2) return { vx: 0, vy: signY * SHOT_SPEED_UNITS_PER_TICK };
  return {
    vx: signX * SHOT_DIAGONAL_SPEED_UNITS_PER_TICK,
    vy: signY * SHOT_DIAGONAL_SPEED_UNITS_PER_TICK,
  };
}

export function segmentHitsCircle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number,
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const offsetX = centerX - startX;
    const offsetY = centerY - startY;
    return offsetX * offsetX + offsetY * offsetY <= radius * radius;
  }

  const toCenterX = centerX - startX;
  const toCenterY = centerY - startY;
  const dot = toCenterX * dx + toCenterY * dy;
  if (dot <= 0) {
    return toCenterX * toCenterX + toCenterY * toCenterY <= radius * radius;
  }
  if (dot >= lengthSquared) {
    const endOffsetX = centerX - endX;
    const endOffsetY = centerY - endY;
    return endOffsetX * endOffsetX + endOffsetY * endOffsetY <= radius * radius;
  }

  const cross = dx * toCenterY - dy * toCenterX;
  const left = BigInt(Math.trunc(cross)) * BigInt(Math.trunc(cross));
  const right = BigInt(Math.trunc(radius * radius)) * BigInt(Math.trunc(lengthSquared));
  return left <= right;
}

export function segmentHitsObstacle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacle: ObstacleCell,
  padding = 0,
): boolean {
  // Use the same rounded Minkowski obstacle as player movement. Padding a
  // rectangle by the radius would incorrectly hit paths that only pass the
  // square corner; this matters for diagonal shots and keeps every moving
  // object on one collision contract.
  const radius = Math.max(0, Math.trunc(padding));
  return firstContactForObstacle(
    startX,
    startY,
    endX - startX,
    endY - startY,
    obstacle,
    radius,
  ) !== null;
}

export function applyPush(
  player: PlayerState,
  vx: number,
  vy: number,
  obstacles: readonly ObstacleCell[] = [],
): PlayerState {
  return movePlayerWithObstacles(
    player,
    Math.sign(vx) * SHOT_PUSH_UNITS,
    Math.sign(vy) * SHOT_PUSH_UNITS,
    obstacles,
  );
}
