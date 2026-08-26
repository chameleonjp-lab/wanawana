import {
  DEFAULT_MAP_ID,
  DEFAULT_TRAP_LOADOUT,
  type CpuDifficulty,
  type MapId,
  type TrapLoadout,
} from './types.ts';
import { isMapId } from './maps.ts';
import { isTrapKind, normalizeTrapLoadout } from './fixed.ts';

export const SETTINGS_SCHEMA_VERSION = 2 as const;
export const SETTINGS_STORAGE_KEY = 'wanawana:v1:settings';

export interface MatchSettings {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly difficulty: CpuDifficulty;
  readonly mapId: MapId;
  readonly loadout: TrapLoadout;
  readonly lightweight: boolean;
}

export function defaultMatchSettings(): MatchSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    difficulty: 'normal',
    mapId: DEFAULT_MAP_ID,
    loadout: DEFAULT_TRAP_LOADOUT,
    lightweight: false,
  };
}

function isDifficulty(value: unknown): value is CpuDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function isCanonicalLoadout(value: unknown): value is TrapLoadout {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((kind) => isTrapKind(kind))) return false;
  const loadout = value as unknown as TrapLoadout;
  const normalized = normalizeTrapLoadout(loadout);
  return normalized.every((kind, index) => kind === loadout[index]);
}

function isSettings(value: unknown): value is MatchSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return keys.length === 5
    && keys.every((key) => key === 'schemaVersion' || key === 'difficulty' || key === 'mapId' || key === 'loadout' || key === 'lightweight')
    && candidate.schemaVersion === SETTINGS_SCHEMA_VERSION
    && isDifficulty(candidate.difficulty)
    && isMapId(candidate.mapId)
    && isCanonicalLoadout(candidate.loadout)
    && typeof candidate.lightweight === 'boolean';
}

/**
 * Reads only the small, versioned settings payload used by the title screen.
 * Any malformed, future, or non-canonical value is discarded as a whole so a
 * partial old setting can never change the rules of a match.
 */
export function readMatchSettings(raw: string | null | undefined): MatchSettings {
  if (!raw) return defaultMatchSettings();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSettings(parsed) ? parsed : defaultMatchSettings();
  } catch {
    return defaultMatchSettings();
  }
}

export function serializeMatchSettings(settings: MatchSettings): string {
  return JSON.stringify(settings);
}

export function createMatchSettings(
  difficulty: CpuDifficulty,
  mapId: MapId,
  loadout: readonly string[],
  lightweight = false,
): MatchSettings {
  const normalized = normalizeTrapLoadout(loadout.filter(isTrapKind));
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    difficulty: isDifficulty(difficulty) ? difficulty : 'normal',
    mapId: isMapId(mapId) ? mapId : DEFAULT_MAP_ID,
    loadout: normalized,
    lightweight,
  };
}
