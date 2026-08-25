import { describe, expect, it } from 'vitest';
import { directionFromAxes, discreteAxis, normalizeKey } from '../../src/input/controller.ts';

describe('input normalization', () => {
  it('keeps the center of the movement pad neutral', () => {
    expect(discreteAxis(0)).toBe(0);
    expect(discreteAxis(0.19)).toBe(0);
    expect(discreteAxis(-0.19)).toBe(0);
  });

  it('converts a pad direction to one of three integer axes', () => {
    expect(discreteAxis(0.2)).toBe(1);
    expect(discreteAxis(-0.8)).toBe(-1);
    expect(discreteAxis(Number.NaN)).toBe(0);
  });

  it('normalizes letter keys without changing arrow keys', () => {
    expect(normalizeKey('W')).toBe('w');
    expect(normalizeKey('d')).toBe('d');
    expect(normalizeKey('ArrowLeft')).toBe('ArrowLeft');
  });

  it('maps movement axes to the four trap directions', () => {
    expect(directionFromAxes(0, -1)).toBe(0);
    expect(directionFromAxes(1, 0)).toBe(1);
    expect(directionFromAxes(0, 1)).toBe(2);
    expect(directionFromAxes(-1, 0)).toBe(3);
    expect(directionFromAxes(1, 1)).toBe(1);
  });
});
