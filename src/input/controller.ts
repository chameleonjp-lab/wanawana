import type { InputCommand, TrapKind } from '../core/types.ts';

type PointerRole = 'move' | 'fire' | 'inspect' | 'trap';

interface ActivePointer {
  readonly role: PointerRole;
  readonly trapKind?: TrapKind;
  readonly target: HTMLElement;
  readonly rect: DOMRect;
  x: number;
  y: number;
}

interface TrapCell {
  readonly cellX: number;
  readonly cellY: number;
}

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);
const TRAP_KEYS = new Map<string, TrapKind>([
  ['1', 'bounce'],
  ['2', 'shock'],
  ['3', 'hatch'],
  ['4', 'bomb'],
  ['5', 'moya'],
]);
const FIRE_KEY = ' ';
const INSPECT_KEY = 'e';
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
  private trapKeyArmed: TrapKind | null = null;
  private trapPending: TrapKind | null = null;
  private trapPendingCell: TrapCell | null = null;
  private trapPreview: TrapKind | null = null;
  private trapPreviewCell: TrapCell | null = null;
  private investigateHeld = false;
  private investigateStartPending = false;
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
    this.trapKeyArmed = null;
    this.trapPending = null;
    this.trapPendingCell = null;
    this.trapPreview = null;
    this.trapPreviewCell = null;
    this.investigateHeld = false;
    this.investigateStartPending = false;
  }

  public get previewTrap(): TrapKind | null {
    return this.trapPreview;
  }

  public get previewCell(): TrapCell | null {
    return this.trapPreviewCell;
  }

  /** Freeze the grid cell at the first fixed-tick observation of a held trap card. */
  public capturePreviewCell(cellX: number, cellY: number): void {
    if (!this.trapPreview || this.trapPreviewCell) return;
    this.trapPreviewCell = { cellX, cellY };
  }

  public readCommand(): InputCommand {
    const movePointer = [...this.pointers.values()].find((pointer) => pointer.role === 'move');
    const move = movePointer ? this.readPadAxes(movePointer) : this.readKeyboardAxes();
    const command: InputCommand = {
      moveX: move.moveX,
      moveY: move.moveY,
      fire: this.firePending,
      placeTrap: this.trapPending ?? undefined,
      trapDirection: 0,
      trapCellX: this.trapPendingCell?.cellX,
      trapCellY: this.trapPendingCell?.cellY,
      investigate: this.investigateHeld,
      investigateStart: this.investigateStartPending,
    };
    this.firePending = false;
    this.trapPending = null;
    this.trapPendingCell = null;
    this.investigateStartPending = false;
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

  private roleFromTarget(target: HTMLElement): { role: PointerRole; trapKind?: TrapKind } | null {
    const rawRole = target.dataset.inputRole;
    if (rawRole === 'move' || rawRole === 'fire' || rawRole === 'inspect') return { role: rawRole };
    if (
      rawRole === 'trap-bounce'
      || rawRole === 'trap-shock'
      || rawRole === 'trap-hatch'
      || rawRole === 'trap-bomb'
      || rawRole === 'trap-moya'
    ) {
      return { role: 'trap', trapKind: rawRole.slice(5) as TrapKind };
    }
    return null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.active || this.pointers.size >= 2) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-input-role]')
      : null;
    if (!target || !this.root.contains(target)) return;
    const role = this.roleFromTarget(target);
    if (!role) return;
    if ([...this.pointers.values()].some((pointer) => pointer.role === role.role)) return;

    const rect = target.getBoundingClientRect();
    this.pointers.set(event.pointerId, {
      role: role.role,
      trapKind: role.trapKind,
      target,
      rect,
      x: event.clientX,
      y: event.clientY,
    });
    if (role.role === 'fire') this.firePending = false;
    if (role.role === 'inspect') {
      this.investigateHeld = true;
      this.investigateStartPending = true;
    }
    if (role.role === 'trap' && role.trapKind) {
      this.trapPreview = role.trapKind;
      this.trapPreviewCell = null;
    }
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
    const rootRect = this.root.getBoundingClientRect();
    const insideRoot = event.clientX >= rootRect.left && event.clientX <= rootRect.right
      && event.clientY >= rootRect.top && event.clientY <= rootRect.bottom;
    if (pointer.role === 'fire') this.firePending = insideRoot;
    if (pointer.role === 'inspect') this.investigateHeld = false;
    if (pointer.role === 'trap') {
      this.trapPending = insideRoot ? pointer.trapKind ?? null : null;
      this.trapPendingCell = insideRoot ? this.trapPreviewCell : null;
      this.trapPreview = null;
      this.trapPreviewCell = null;
    }
    this.releasePointer(event.pointerId, pointer);
    event.preventDefault();
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    if (pointer.role === 'inspect') this.investigateHeld = false;
    if (pointer.role === 'trap') this.trapPreview = null;
    if (pointer.role === 'trap') this.trapPreviewCell = null;
    this.releasePointer(event.pointerId, pointer);
    event.preventDefault();
  };

  private handleLostPointerCapture = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    if (pointer.role === 'inspect') this.investigateHeld = false;
    if (pointer.role === 'trap') this.trapPreview = null;
    if (pointer.role === 'trap') this.trapPreviewCell = null;
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
    const trapKind = TRAP_KEYS.get(key);
    if (!MOVE_KEYS.has(key) && key !== FIRE_KEY && key !== INSPECT_KEY && !trapKind) return;
    event.preventDefault();
    if (key === FIRE_KEY) {
      if (!event.repeat) this.fireKeyArmed = true;
      return;
    }
    if (key === INSPECT_KEY) {
      if (!event.repeat) {
        this.investigateHeld = true;
        this.investigateStartPending = true;
      }
      return;
    }
    if (trapKind) {
      if (!event.repeat) {
        this.trapKeyArmed = trapKind;
        this.trapPreview = trapKind;
        this.trapPreviewCell = null;
      }
      return;
    }
    this.pressedKeys.add(key);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const key = normalizeKey(event.key);
    const trapKind = TRAP_KEYS.get(key);
    if (!MOVE_KEYS.has(key) && key !== FIRE_KEY && key !== INSPECT_KEY && !trapKind) return;
    event.preventDefault();
    if (key === FIRE_KEY) {
      if (this.fireKeyArmed) this.firePending = true;
      this.fireKeyArmed = false;
      return;
    }
    if (key === INSPECT_KEY) {
      this.investigateHeld = false;
      return;
    }
    if (trapKind) {
      if (this.trapKeyArmed === trapKind) {
        this.trapPending = trapKind;
        this.trapPendingCell = this.trapPreviewCell;
      }
      this.trapKeyArmed = null;
      this.trapPreview = null;
      this.trapPreviewCell = null;
      return;
    }
    this.pressedKeys.delete(key);
  };
}
