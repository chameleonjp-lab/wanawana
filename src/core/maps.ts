import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  DEFAULT_MAP_ID,
  MAP_IDS,
  type MapId,
} from './types.ts';

export interface MapDefinition {
  readonly id: MapId;
  readonly name: string;
  readonly subtitle: string;
  readonly playerSpawn: readonly [number, number];
  readonly cpuSpawn: readonly [number, number];
  readonly backgroundColor: number;
  readonly gridColor: number;
  readonly accentColor: number;
  readonly landmark: 'gear' | 'crossroads' | 'ring';
}

const MAP_DEFINITIONS: Readonly<Record<MapId, MapDefinition>> = {
  gearworks: {
    id: 'gearworks',
    name: '大歯車劇場',
    subtitle: '歯車の中心で読み合う',
    playerSpawn: [2, 6],
    cpuSpawn: [7, 6],
    backgroundColor: 0x0f0d1b,
    gridColor: 0x3b2c54,
    accentColor: 0x8f70ad,
    landmark: 'gear',
  },
  crossroads: {
    id: 'crossroads',
    name: '四つ辻の舞台',
    subtitle: '中央の交差を使う',
    playerSpawn: [1, 1],
    cpuSpawn: [7, 11],
    backgroundColor: 0x0d1a1a,
    gridColor: 0x2b5a55,
    accentColor: 0x6fd1c4,
    landmark: 'crossroads',
  },
  ring: {
    id: 'ring',
    name: '輪の間',
    subtitle: '外周から包囲する',
    playerSpawn: [1, 11],
    cpuSpawn: [7, 1],
    backgroundColor: 0x1a130d,
    gridColor: 0x60482d,
    accentColor: 0xffb45f,
    landmark: 'ring',
  },
};

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && (MAP_IDS as readonly string[]).includes(value);
}

export function getMapDefinition(mapId: MapId | string | undefined): MapDefinition {
  return MAP_DEFINITIONS[isMapId(mapId) ? mapId : DEFAULT_MAP_ID];
}

export function spawnCellFor(mapId: MapId | string | undefined, playerId: 0 | 1): readonly [number, number] {
  const map = getMapDefinition(mapId);
  const spawn = playerId === 0 ? map.playerSpawn : map.cpuSpawn;
  const cellX = Math.min(ARENA_WIDTH_CELLS - 1, Math.max(0, Math.trunc(spawn[0])));
  const cellY = Math.min(ARENA_HEIGHT_CELLS - 1, Math.max(0, Math.trunc(spawn[1])));
  return [cellX, cellY];
}
