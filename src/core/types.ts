export const TICK_RATE = 60;
export const MATCH_TICKS = 150 * TICK_RATE;
export const CELL_UNITS = 9_600;
export const ARENA_WIDTH_CELLS = 9;
export const ARENA_HEIGHT_CELLS = 13;

export const TRAP_KINDS = ['bounce', 'shock', 'hatch', 'bomb', 'moya'] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];
export type TrapLoadout = readonly [TrapKind, TrapKind, TrapKind];
export const DEFAULT_TRAP_LOADOUT: TrapLoadout = ['bounce', 'shock', 'hatch'];
export type TrapDirection = 0 | 1 | 2 | 3;
export type InvestigationMode = 'reveal' | 'disarm';
export type MatchResult = 'player-win' | 'cpu-win' | 'draw' | 'time-draw' | 'technical-invalid';
export type CpuDifficulty = 'easy' | 'normal' | 'hard';
export const MAP_IDS = ['gearworks', 'crossroads', 'ring'] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP_ID: MapId = 'gearworks';

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
  /** Remaining fuse ticks after a player has entered a bomb. */
  readonly triggerTicks?: number;
  /** Remaining active ticks for a triggered moya gas field. */
  readonly effectTicks?: number;
  /** The chain context captured when a delayed trap is triggered. */
  readonly triggerParentEventId?: number | null;
  readonly triggerChainId?: number | null;
  readonly triggerChainLength?: number;
  readonly triggerResponsibleActor?: 0 | 1;
}

export type GamePhase = 'title' | 'battle' | 'paused' | 'result';

export interface PlayerState {
  readonly id: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly fireCooldownTicks: number;
  readonly fireSlowTicks: number;
  readonly gasSlowTicks: number;
  readonly pushImmunityTicks: number;
  readonly trapCooldownTicks: number;
  readonly gear: number;
  readonly gearRecoveryTicks: number;
  readonly placement: PlacementState | null;
  readonly investigation: InvestigationState | null;
  readonly investigationPauseTicks: number;
  readonly disabledTicks: number;
  readonly respawnInvulnerableTicks: number;
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
  readonly mapId: MapId;
  readonly loadouts: readonly [TrapLoadout, TrapLoadout];
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
  readonly traps: readonly TrapState[];
  readonly nextEntityId: number;
  readonly shotsFired: readonly [number, number];
  readonly trapsPlaced: readonly [number, number];
  readonly trapsDisarmed: readonly [number, number];
  readonly events: readonly TrapEvent[];
  readonly nextEventId: number;
  readonly nextChainId: number;
  readonly maxChain: number;
  readonly result: MatchResult | null;
  readonly lastHash: string;
}

export interface ObstacleCell {
  readonly cellX: number;
  readonly cellY: number;
}

export interface TrapEvent {
  readonly id: number;
  readonly tick: number;
  readonly chainId: number;
  readonly parentEventId: number | null;
  readonly chainLength: number;
  readonly trapId: number;
  readonly owner: 0 | 1;
  readonly kind: TrapKind;
  readonly target: 0 | 1;
  readonly responsibleActor: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly damage: number;
  readonly pushX: number;
  readonly pushY: number;
}
