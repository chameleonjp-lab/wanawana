import type { InputCommand } from '../core/types.ts';

type PointerRole = 'move' | 'fire';

interface ActivePointer {
  readonly role: PointerRole;
  readonly target: HTMLElement;
  readonly rect: DOMRect;
  x: number;
  y: number;
}

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
const FIRE_KEY = ' ';
const DEAD_ZONE = 0.2;

export function discreteAxis(value: number, deadZone = DEAD_ZONE): -1 | 0 | 1 {
  if (!Number.isFinite(value) || Math.abs(value) < deadZone) return 0;
  return value < 0 ? -1 : 1;
}

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export class InputController {
  private readonly pointers = new Map<number, ActivePointer>();
  private readonly pressedKeys = new Set<string>();
  private fireKeyArmed = false;
  private firePending = false;
  private active = false;

  public constructor(private readonly root: HTMLElement) {
    root.addEventListener('pointerdown', this.handlePointerDown);
    root.addEventListener('pointermove', this.handlePointerMove);
    root.addEventListener('pointerup', this.handlePointerUp);
    root.addEventListener('pointercancel', this.handlePointerCancel);
    root.addEventListener('lostpointercapture', this.handleLostPointerCapture);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public activate(): void {
    this.active = true;
    this.reset();
  }

  public deactivate(): void {
    this.active = false;
    this.reset();
  }

  public reset(): void {
    for (const [pointerId, pointer] of this.pointers) {
      try {
        if (pointer.target.hasPointerCapture(pointerId)) pointer.target.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }
    this.pointers.clear();
    this.pressedKeys.clear();
    this.fireKeyArmed = false;
    this.firePending = false;
  }

  public readCommand(): InputCommand {
    const movePointer = [...this.pointers.values()].find((pointer) => pointer.role === 'move');
    const move = movePointer ? this.readPadAxes(movePointer) : this.readKeyboardAxes();
    const command: InputCommand = {
      moveX: move.moveX,
      moveY: move.moveY,
      fire: this.firePending,
    };
    this.firePending = false;
    return command;
  }

  private readPadAxes(pointer: ActivePointer): Pick<InputCommand, 'moveX' | 'moveY'> {
    const width = Math.max(1, pointer.rect.width);
    const height = Math.max(1, pointer.rect.height);
    const normalizedX = ((pointer.x - pointer.rect.left) / width) * 2 - 1;
    const normalizedY = ((pointer.y - pointer.rect.top) / height) * 2 - 1;
    return { moveX: discreteAxis(normalizedX), moveY: discreteAxis(normalizedY) };
  }

  private readKeyboardAxes(): Pick<InputCommand, 'moveX' | 'moveY'> {
    const left = this.pressedKeys.has('ArrowLeft') || this.pressedKeys.has('a');
    const right = this.pressedKeys.has('ArrowRight') || this.pressedKeys.has('d');
    const up = this.pressedKeys.has('ArrowUp') || this.pressedKeys.has('w');
    const down = this.pressedKeys.has('ArrowDown') || this.pressedKeys.has('s');
    return {
      moveX: left === right ? 0 : left ? -1 : 1,
      moveY: up === down ? 0 : up ? -1 : 1,
    };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.active || this.pointers.size >= 2) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-input-role]')
      : null;
    if (!target || !this.root.contains(target)) return;
    const role = target.dataset.inputRole;
    if (role !== 'move' && role !== 'fire') return;
    if ([...this.pointers.values()].some((pointer) => pointer.role === role)) return;

    const rect = target.getBoundingClientRect();
    this.pointers.set(event.pointerId, {
      role,
      target,
      rect,
      x: event.clientX,
      y: event.clientY,
    });
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // A browser may reject capture when the pointer has already ended.
    }
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    event.preventDefault();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    if (pointer.role === 'fire') this.firePending = true;
    this.releasePointer(event.pointerId, pointer);
    event.preventDefault();
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.releasePointer(event.pointerId, pointer);
    event.preventDefault();
  };

  private handleLostPointerCapture = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    this.pointers.delete(event.pointerId);
  };

  private releasePointer(pointerId: number, pointer: ActivePointer): void {
    this.pointers.delete(pointerId);
    try {
      if (pointer.target.hasPointerCapture(pointerId)) pointer.target.releasePointerCapture(pointerId);
    } catch {
      // The pointer was already released or cancelled by the browser.
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const key = normalizeKey(event.key);
    if (!MOVE_KEYS.has(key) && key !== FIRE_KEY) return;
    event.preventDefault();
    if (key === FIRE_KEY) {
      if (!event.repeat) this.fireKeyArmed = true;
      return;
    }
    this.pressedKeys.add(key);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const key = normalizeKey(event.key);
    if (!MOVE_KEYS.has(key) && key !== FIRE_KEY) return;
    event.preventDefault();
    if (key === FIRE_KEY) {
      if (this.fireKeyArmed) this.firePending = true;
      this.fireKeyArmed = false;
      return;
    }
    this.pressedKeys.delete(key);
  };
}
