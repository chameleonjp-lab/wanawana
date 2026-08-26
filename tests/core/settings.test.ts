import { describe, expect, it } from 'vitest';
import {
  createMatchSettings,
  defaultMatchSettings,
  readMatchSettings,
  serializeMatchSettings,
} from '../../src/core/settings.ts';

describe('title settings', () => {
  it('starts with the documented defaults', () => {
    expect(defaultMatchSettings()).toEqual({
      schemaVersion: 2,
      difficulty: 'normal',
      mapId: 'gearworks',
      loadout: ['bounce', 'shock', 'hatch'],
      lightweight: false,
    });
  });

  it('round-trips a canonical difficulty, map, loadout, and display mode', () => {
    const settings = createMatchSettings('hard', 'ring', ['bounce', 'bomb', 'moya'], true);
    expect(readMatchSettings(serializeMatchSettings(settings))).toEqual(settings);
    expect(settings.lightweight).toBe(true);
  });

  it('normalizes selections before saving', () => {
    expect(createMatchSettings('easy', 'crossroads', ['shock', 'shock', 'bomb'])).toEqual({
      schemaVersion: 2,
      difficulty: 'easy',
      mapId: 'crossroads',
      loadout: ['bounce', 'shock', 'bomb'],
      lightweight: false,
    });
  });

  it('rejects malformed, future, and non-canonical values as one payload', () => {
    const malformed = [
      '{not-json',
      JSON.stringify({ schemaVersion: 3 }),
      JSON.stringify({ ...defaultMatchSettings(), difficulty: 'nightmare' }),
      JSON.stringify({ ...defaultMatchSettings(), mapId: 'secret' }),
      JSON.stringify({ ...defaultMatchSettings(), loadout: ['bounce', 'shock', 'shock'] }),
      JSON.stringify({ ...defaultMatchSettings(), lightweight: 'yes' }),
      JSON.stringify({
        schemaVersion: 2,
        difficulty: 'normal',
        mapId: 'gearworks',
        loadout: ['bounce', 'shock', 'hatch'],
      }),
    ];

    for (const raw of malformed) expect(readMatchSettings(raw)).toEqual(defaultMatchSettings());
  });

  it('does not trust extra storage fields', () => {
    const raw = JSON.stringify({
      ...defaultMatchSettings(),
      accountId: 'should-not-be-saved',
    });
    expect(readMatchSettings(raw)).toEqual(defaultMatchSettings());
  });
});
