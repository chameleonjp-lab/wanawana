export const TICK_RATE = 60;
export const MATCH_TICKS = 150 * TICK_RATE;
export const CELL_UNITS = 9_600;
export const ARENA_WIDTH_CELLS = 9;
export const ARENA_HEIGHT_CELLS = 13;

export const TRAP_KINDS = ['bounce', 'shock', 'hatch'] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];
export type TrapDirection = 0 | 1 | 2 | 3;
export type InvestigationMode = 'reveal' | 'disarm';

export interface PlacementState {
  readonly kind: TrapKind;
  readonly direction: TrapDirection;
  readonly cellX: number;
  readonly cellY: number;
  readonly remainingTicks: number;
}

export interface InvestigationState {
  readonly targetTrapId: number;
  readonly mode: InvestigationMode;
  readonly startX: number;
  readonly startY: number;
  readonly remainingTicks: number;
}

export interface TrapState {
  readonly id: number;
  readonly owner: 0 | 1;
  readonly kind: TrapKind;
  readonly direction: TrapDirection;
  readonly cellX: number;
  readonly cellY: number;
  readonly armingTicks: number;
  readonly remainingTicks: number;
  readonly discoveredBy: readonly [boolean, boolean];
}

export type GamePhase = 'title' | 'battle' | 'paused' | 'result';

export interface PlayerState {
  readonly id: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly fireCooldownTicks: number;
  readonly fireSlowTicks: number;
  readonly pushImmunityTicks: number;
  readonly trapCooldownTicks: number;
  readonly gear: number;
  readonly gearRecoveryTicks: number;
  readonly placement: PlacementState | null;
  readonly investigation: InvestigationState | null;
  readonly investigationPauseTicks: number;
}

export interface ShotState {
  readonly id: number;
  readonly owner: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly travelledUnits: number;
}

export interface InputCommand {
  readonly moveX: -1 | 0 | 1;
  readonly moveY: -1 | 0 | 1;
  readonly fire: boolean;
  readonly placeTrap?: TrapKind;
  readonly trapDirection: TrapDirection;
  readonly trapCellX?: number;
  readonly trapCellY?: number;
  readonly investigate?: boolean;
  readonly investigateStart?: boolean;
}

export interface WorldState {
  readonly phase: GamePhase;
  readonly tick: number;
  readonly seed: number;
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
  readonly traps: readonly TrapState[];
  readonly nextEntityId: number;
  readonly shotsFired: readonly [number, number];
  readonly trapsPlaced: readonly [number, number];
  readonly trapsDisarmed: readonly [number, number];
  readonly lastHash: string;
}
