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

function moveAlongAxis(
  x: number,
  y: number,
  delta: number,
  axis: 'x' | 'y',
  obstacles: readonly ObstacleCell[],
): number {
  const start = axis === 'x' ? x : y;
  const target = clampInteger(
    start + delta,
    axis === 'x' ? MIN_X : MIN_Y,
    axis === 'x' ? MAX_X : MAX_Y,
  );
  if (delta === 0 || obstacles.length === 0) return target;

  const positionAt = (distance: number): { x: number; y: number } => ({
    x: axis === 'x' ? start + Math.sign(delta) * distance : x,
    y: axis === 'y' ? start + Math.sign(delta) * distance : y,
  });
  const targetPosition = positionAt(Math.abs(target - start));
  if (!circleIntersectsObstacle(targetPosition.x, targetPosition.y, PLAYER_RADIUS_UNITS, obstacles)) return target;

  let safeDistance = 0;
  const blockedDistance = Math.abs(target - start);
  for (let probe = COLLISION_SEARCH_STEP_UNITS; probe < blockedDistance; probe += COLLISION_SEARCH_STEP_UNITS) {
    const position = positionAt(probe);
    if (circleIntersectsObstacle(position.x, position.y, PLAYER_RADIUS_UNITS, obstacles)) break;
    safeDistance = probe;
  }

  let low = safeDistance;
  let high = blockedDistance;
  for (let iteration = 0; iteration < 18 && high - low > 1; iteration += 1) {
    const middle = Math.floor((low + high) / 2);
    const position = positionAt(middle);
    if (circleIntersectsObstacle(position.x, position.y, PLAYER_RADIUS_UNITS, obstacles)) high = middle;
    else low = middle;
  }
  const safePosition = positionAt(low);
  return axis === 'x' ? safePosition.x : safePosition.y;
}

export function movePlayerWithObstacles(
  player: PlayerState,
  deltaX: number,
  deltaY: number,
  obstacles: readonly ObstacleCell[] = [],
): PlayerState {
  const nextX = moveAlongAxis(player.x, player.y, deltaX, 'x', obstacles);
  const nextY = moveAlongAxis(nextX, player.y, deltaY, 'y', obstacles);
  return { ...player, x: nextX, y: nextY };
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

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
    && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

function segmentsIntersect(
  firstStartX: number,
  firstStartY: number,
  firstEndX: number,
  firstEndY: number,
  secondStartX: number,
  secondStartY: number,
  secondEndX: number,
  secondEndY: number,
): boolean {
  const first = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY);
  const second = orientation(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY);
  const third = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY);
  const fourth = orientation(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
  if (((first > 0 && second < 0) || (first < 0 && second > 0))
    && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))) return true;
  if (first === 0 && pointOnSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondStartX, secondStartY)) return true;
  if (second === 0 && pointOnSegment(firstStartX, firstStartY, firstEndX, firstEndY, secondEndX, secondEndY)) return true;
  if (third === 0 && pointOnSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstStartX, firstStartY)) return true;
  return fourth === 0 && pointOnSegment(secondStartX, secondStartY, secondEndX, secondEndY, firstEndX, firstEndY);
}

export function segmentHitsObstacle(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacle: ObstacleCell,
  padding = 0,
): boolean {
  const left = obstacle.cellX * CELL_UNITS - padding;
  const right = (obstacle.cellX + 1) * CELL_UNITS + padding;
  const top = obstacle.cellY * CELL_UNITS - padding;
  const bottom = (obstacle.cellY + 1) * CELL_UNITS + padding;
  if (Math.max(startX, endX) < left || Math.min(startX, endX) > right
    || Math.max(startY, endY) < top || Math.min(startY, endY) > bottom) return false;
  const inside = (x: number, y: number): boolean => x >= left && x <= right && y >= top && y <= bottom;
  if (inside(startX, startY) || inside(endX, endY)) return true;
  return segmentsIntersect(startX, startY, endX, endY, left, top, right, top)
    || segmentsIntersect(startX, startY, endX, endY, right, top, right, bottom)
    || segmentsIntersect(startX, startY, endX, endY, right, bottom, left, bottom)
    || segmentsIntersect(startX, startY, endX, endY, left, bottom, left, top);
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
