export const TICK_RATE = 60;
export const MATCH_TICKS = 150 * TICK_RATE;
export const CELL_UNITS = 9_600;
export const ARENA_WIDTH_CELLS = 9;
export const ARENA_HEIGHT_CELLS = 13;

export type GamePhase = 'title' | 'battle' | 'paused' | 'result';

export interface PlayerState {
  readonly id: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

export interface InputCommand {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly fire: boolean;
}

export interface WorldState {
  readonly phase: GamePhase;
  readonly tick: number;
  readonly seed: number;
  readonly players: readonly [PlayerState, PlayerState];
  readonly shotsFired: readonly [number, number];
  readonly lastHash: string;
}
