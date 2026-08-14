import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  type InputCommand,
  type PlayerState,
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

const MIN_X = PLAYER_RADIUS_UNITS;
const MIN_Y = PLAYER_RADIUS_UNITS;
const MAX_X = ARENA_WIDTH_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;
const MAX_Y = ARENA_HEIGHT_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function applyMovement(player: PlayerState, command: InputCommand): PlayerState {
  const speed = player.fireSlowTicks > 0
    ? PLAYER_SLOWED_SPEED_UNITS_PER_TICK
    : PLAYER_SPEED_UNITS_PER_TICK;
  const nextX = clampInteger(
    player.x + command.moveX * speed,
    MIN_X,
    MAX_X,
  );
  const nextY = clampInteger(
    player.y + command.moveY * speed,
    MIN_Y,
    MAX_Y,
  );

  return { ...player, x: nextX, y: nextY };
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
  };
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

export function applyPush(player: PlayerState, vx: number, vy: number): PlayerState {
  return {
    ...player,
    x: clampInteger(player.x + Math.sign(vx) * SHOT_PUSH_UNITS, MIN_X, MAX_X),
    y: clampInteger(player.y + Math.sign(vy) * SHOT_PUSH_UNITS, MIN_Y, MAX_Y),
  };
}
