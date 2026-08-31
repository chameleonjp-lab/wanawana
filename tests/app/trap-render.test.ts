import { describe, expect, it } from 'vitest';
import {
  drawTrap,
  drawTrapEvent,
  drawTrapPreview,
  TRAP_DIRECTION_VECTORS,
  type TrapGraphics,
  type TrapVisualState,
} from '../../src/app/trap-render.ts';

interface FakeGraphics extends TrapGraphics {
  readonly calls: string[];
}

function createGraphics(): FakeGraphics {
  const calls: string[] = [];
  let graphics!: FakeGraphics;
  graphics = {
    calls,
    circle(x, y, radius) {
      calls.push('circle:' + x + ':' + y + ':' + radius);
      return graphics;
    },
    roundRect(x, y, width, height, radius) {
      calls.push('roundRect:' + x + ':' + y + ':' + width + ':' + height + ':' + radius);
      return graphics;
    },
    moveTo(x, y) {
      calls.push('moveTo:' + x + ':' + y);
      return graphics;
    },
    lineTo(x, y) {
      calls.push('lineTo:' + x + ':' + y);
      return graphics;
    },
    fill(style) {
      calls.push('fill:' + style.color + ':' + (style.alpha ?? 1));
      return graphics;
    },
    stroke(style) {
      calls.push('stroke:' + style.color + ':' + (style.alpha ?? 1) + ':' + (style.width ?? 0));
      return graphics;
    },
  };
  return graphics;
}

function baseTrap(overrides: Partial<TrapVisualState> = {}): TrapVisualState {
  return {
    x: 50,
    y: 70,
    size: 40,
    kind: 'bounce',
    direction: 1,
    owner: 0,
    discovered: true,
    color: 0x8cbdff,
    tick: 20,
    armingTicks: 0,
    remainingTicks: 1_000,
    triggerTicks: 0,
    effectTicks: 0,
    effectRadius: 100,
    ...overrides,
  };
}

describe('trap rendering', () => {
  it('keeps the four direction vectors stable', () => {
    expect(TRAP_DIRECTION_VECTORS).toEqual({
      0: [0, -1],
      1: [1, 0],
      2: [0, 1],
      3: [-1, 0],
    });
  });

  it('renders every trap kind with a visible identifying shape', () => {
    const shapes = new Map<string, string[]>();
    const trapKinds = [
      ['bounce', 0x8cbdff],
      ['shock', 0xffdc73],
      ['hatch', 0xff99c8],
      ['bomb', 0xff9b54],
      ['moya', 0x9ad7a5],
    ] as const;

    for (const [kind, color] of trapKinds) {
      const graphics = createGraphics();
      drawTrap(graphics, baseTrap({ kind, color }));
      shapes.set(kind, graphics.calls);
    }

    expect(shapes.get('bounce')?.some((call) => call.startsWith('lineTo:'))).toBe(true);
    expect(shapes.get('shock')?.filter((call) => call.startsWith('circle:')).length).toBeGreaterThanOrEqual(2);
    expect(shapes.get('hatch')?.some((call) => call.startsWith('roundRect:'))).toBe(true);
    expect(shapes.get('bomb')?.filter((call) => call.startsWith('circle:')).length).toBeGreaterThanOrEqual(3);
    expect(shapes.get('moya')?.filter((call) => call.startsWith('roundRect:')).length).toBeGreaterThanOrEqual(2);
  });

  it('does not reveal an undiscovered enemy trap', () => {
    const graphics = createGraphics();
    drawTrap(graphics, baseTrap({ owner: 1, discovered: false }));
    expect(graphics.calls).toEqual([]);
  });

  it('marks armed state, ownership, delayed activation, and active gas range', () => {
    const arming = createGraphics();
    drawTrap(arming, baseTrap({ armingTicks: 12 }));
    expect(arming.calls.some((call) => call.startsWith('moveTo:'))).toBe(true);

    const own = createGraphics();
    drawTrap(own, baseTrap());
    const enemy = createGraphics();
    drawTrap(enemy, baseTrap({ owner: 1, discovered: true }));
    expect(enemy.calls.filter((call) => call.startsWith('moveTo:')).length)
      .toBeGreaterThan(own.calls.filter((call) => call.startsWith('moveTo:')).length);

    const bomb = createGraphics();
    drawTrap(bomb, baseTrap({ kind: 'bomb', color: 0xff9b54, triggerTicks: 20 }));
    expect(bomb.calls.filter((call) => call.startsWith('circle:')).length)
      .toBeGreaterThan(3);

    const moya = createGraphics();
    drawTrap(moya, baseTrap({ kind: 'moya', color: 0x9ad7a5, effectTicks: 30 }));
    expect(moya.calls.filter((call) => call.startsWith('circle:')).length)
      .toBeGreaterThanOrEqual(4);
  });

  it('uses a separate ghost preview without an ownership badge', () => {
    const graphics = createGraphics();
    drawTrapPreview(graphics, {
      x: 50,
      y: 70,
      size: 40,
      kind: 'bounce',
      direction: 2,
      color: 0x8cbdff,
      tick: 20,
    });
    expect(graphics.calls.some((call) => call.startsWith('stroke:'))).toBe(true);
    expect(graphics.calls.filter((call) => call.startsWith('circle:')).length).toBeLessThan(3);
  });

  it('renders chain activation feedback only while its marker is alive', () => {
    const active = createGraphics();
    drawTrapEvent(active, {
      x: 50,
      y: 70,
      size: 40,
      color: 0xffdc73,
      age: 2,
      eventMarkerTicks: 30,
      burstTicks: 12,
      chainLength: 2,
      showRays: true,
    });
    expect(active.calls.filter((call) => call.startsWith('circle:')).length).toBeGreaterThanOrEqual(3);

    const expired = createGraphics();
    drawTrapEvent(expired, {
      x: 50,
      y: 70,
      size: 40,
      color: 0xffdc73,
      age: 31,
      eventMarkerTicks: 30,
      burstTicks: 12,
      chainLength: 1,
      showRays: true,
    });
    expect(expired.calls).toEqual([]);
  });
});
