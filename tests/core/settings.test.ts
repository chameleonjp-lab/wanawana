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
      schemaVersion: 1,
      difficulty: 'normal',
      mapId: 'gearworks',
      loadout: ['bounce', 'shock', 'hatch'],
    });
  });

  it('round-trips a canonical difficulty, map, and loadout', () => {
    const settings = createMatchSettings('hard', 'ring', ['bounce', 'bomb', 'moya']);
    expect(readMatchSettings(serializeMatchSettings(settings))).toEqual(settings);
  });

  it('normalizes selections before saving', () => {
    expect(createMatchSettings('easy', 'crossroads', ['shock', 'shock', 'bomb'])).toEqual({
      schemaVersion: 1,
      difficulty: 'easy',
      mapId: 'crossroads',
      loadout: ['bounce', 'shock', 'bomb'],
    });
  });

  it('rejects malformed, future, and non-canonical values as one payload', () => {
    const malformed = [
      '{not-json',
      JSON.stringify({ schemaVersion: 2 }),
      JSON.stringify({ ...defaultMatchSettings(), difficulty: 'nightmare' }),
      JSON.stringify({ ...defaultMatchSettings(), mapId: 'secret' }),
      JSON.stringify({ ...defaultMatchSettings(), loadout: ['bounce', 'shock', 'shock'] }),
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
