import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  type InputCommand,
  type PlayerState,
} from './types.ts';

export const PLAYER_SPEED_UNITS_PER_TICK = 512;
export const PLAYER_RADIUS_UNITS = 3_072;

const MIN_X = PLAYER_RADIUS_UNITS;
const MIN_Y = PLAYER_RADIUS_UNITS;
const MAX_X = ARENA_WIDTH_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;
const MAX_Y = ARENA_HEIGHT_CELLS * CELL_UNITS - PLAYER_RADIUS_UNITS;

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function applyMovement(player: PlayerState, command: InputCommand): PlayerState {
  const nextX = clampInteger(
    player.x + command.moveX * PLAYER_SPEED_UNITS_PER_TICK,
    MIN_X,
    MAX_X,
  );
  const nextY = clampInteger(
    player.y + command.moveY * PLAYER_SPEED_UNITS_PER_TICK,
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
