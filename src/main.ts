import { Application, Graphics } from 'pixi.js';
import './styles.css';
import { AppStateMachine } from './app/state.ts';
import { cellToPixels } from './core/fixed.ts';
import { advanceWorld, createWorld } from './core/sim.ts';
import { ARENA_HEIGHT_CELLS, ARENA_WIDTH_CELLS, type InputCommand, type WorldState } from './core/types.ts';

const FRAME_MS = 1_000 / 60;
const MAX_TICKS_PER_FRAME = 5;
const MAX_BACKLOG_TICKS = 8;

const machine = new AppStateMachine();
const status = getElement<HTMLParagraphElement>('status');
const titleView = getElement<HTMLElement>('title-view');
const unsupportedView = getElement<HTMLElement>('unsupported-view');
const battleView = getElement<HTMLElement>('battle-view');
const pauseView = getElement<HTMLElement>('pause-view');
const resultView = getElement<HTMLElement>('result-view');
const arena = getElement<HTMLElement>('arena');
const timeValue = getElement<HTMLElement>('time-value');
const playerHp = getElement<HTMLElement>('player-hp');
const cpuHp = getElement<HTMLElement>('cpu-hp');
const tickValue = getElement<HTMLElement>('tick-value');
const resultSummary = getElement<HTMLElement>('result-summary');
const resultHash = getElement<HTMLElement>('result-hash');

let pixiApp: Application | null = null;
let world: WorldState | null = null;
let frameId = 0;
let lastFrameTime = 0;
let accumulator = 0;
const pressedKeys = new Set<string>();

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.classList.toggle('is-hidden', !visible);
}

function updateScreen(): void {
  const state = machine.state;
  setVisible(titleView, state === 'title');
  setVisible(unsupportedView, state === 'unsupported');
  setVisible(battleView, state === 'battle');
  setVisible(pauseView, state === 'paused');
  setVisible(resultView, state === 'result');
  status.textContent = state === 'battle' ? '固定tickで舞台を動かしています' : state === 'paused' ? '試合を停止しています' : '';
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

async function ensurePixi(): Promise<boolean> {
  if (pixiApp) return true;
  if (!webglAvailable()) {
    machine.transition('unsupported');
    updateScreen();
    return false;
  }

  try {
    const app = new Application();
    await app.init({
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      resizeTo: arena,
      backgroundColor: 0x0f0d1b,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preserveDrawingBuffer: false,
    });
    arena.replaceChildren(app.canvas);
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (machine.state === 'battle') pauseGame('描画領域を失ったため停止しました。復旧後に再開してください。');
    });
    pixiApp = app;
    drawWorld();
    return true;
  } catch {
    machine.transition('unsupported');
    updateScreen();
    return false;
  }
}

function readInput(): InputCommand {
  const left = pressedKeys.has('ArrowLeft') || pressedKeys.has('a');
  const right = pressedKeys.has('ArrowRight') || pressedKeys.has('d');
  const up = pressedKeys.has('ArrowUp') || pressedKeys.has('w');
  const down = pressedKeys.has('ArrowDown') || pressedKeys.has('s');
  return {
    moveX: left === right ? 0 : left ? -1 : 1,
    moveY: up === down ? 0 : up ? -1 : 1,
    fire: pressedKeys.has(' '),
  };
}

function drawWorld(): void {
  if (!pixiApp || !world) return;
  const width = Math.max(1, arena.clientWidth);
  const height = Math.max(1, arena.clientHeight);
  const pixelsPerCell = Math.min(width / ARENA_WIDTH_CELLS, height / ARENA_HEIGHT_CELLS);
  const offsetX = (width - pixelsPerCell * ARENA_WIDTH_CELLS) / 2;
  const offsetY = (height - pixelsPerCell * ARENA_HEIGHT_CELLS) / 2;
  const stage = pixiApp.stage;
  stage.removeChildren();

  const background = new Graphics();
  background.rect(0, 0, width, height).fill({ color: 0x0f0d1b });
  stage.addChild(background);

  const grid = new Graphics();
  for (let column = 0; column <= ARENA_WIDTH_CELLS; column += 1) {
    const x = offsetX + column * pixelsPerCell;
    grid.moveTo(x, offsetY).lineTo(x, offsetY + ARENA_HEIGHT_CELLS * pixelsPerCell);
  }
  for (let row = 0; row <= ARENA_HEIGHT_CELLS; row += 1) {
    const y = offsetY + row * pixelsPerCell;
    grid.moveTo(offsetX, y).lineTo(offsetX + ARENA_WIDTH_CELLS * pixelsPerCell, y);
  }
  grid.stroke({ color: 0x3b2c54, alpha: 0.72, width: 1 });
  stage.addChild(grid);

  for (const player of world.players) {
    const x = offsetX + cellToPixels(player.x, pixelsPerCell);
    const y = offsetY + cellToPixels(player.y, pixelsPerCell);
    const size = Math.max(18, pixelsPerCell * 0.64);
    const color = player.id === 0 ? 0xffd37a : 0xd59aff;
    const token = new Graphics();
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).fill({ color });
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).stroke({ color: 0xffffff, alpha: 0.85, width: 2 });
    stage.addChild(token);
  }

  pixiApp.renderer.render(stage);
}

function updateHud(): void {
  if (!world) return;
  timeValue.textContent = Math.max(0, (150 - world.tick / 60)).toFixed(1);
  playerHp.textContent = String(world.players[0].hp);
  cpuHp.textContent = String(world.players[1].hp);
  tickValue.textContent = String(world.tick);
}

function startLoop(): void {
  cancelAnimationFrame(frameId);
  lastFrameTime = 0;
  accumulator = 0;
  frameId = requestAnimationFrame(loop);
}

function loop(timestamp: number): void {
  if (machine.state !== 'battle' || !world) return;
  if (lastFrameTime === 0) lastFrameTime = timestamp;
  const elapsed = Math.min(250, Math.max(0, timestamp - lastFrameTime));
  lastFrameTime = timestamp;
  accumulator += elapsed;

  if (accumulator > FRAME_MS * MAX_BACKLOG_TICKS) {
    pauseGame('処理が遅れたため安全に停止しました。再開すると時間を合わせ直します。');
    return;
  }

  let processed = 0;
  while (accumulator >= FRAME_MS && processed < MAX_TICKS_PER_FRAME) {
    world = advanceWorld(world, readInput());
    accumulator -= FRAME_MS;
    processed += 1;
  }

  updateHud();
  drawWorld();
  if (world.phase === 'result') {
    finishBattle();
    return;
  }
  frameId = requestAnimationFrame(loop);
}

function pauseGame(message = '試合を停止しています。'): void {
  if (machine.state !== 'battle') return;
  cancelAnimationFrame(frameId);
  pressedKeys.clear();
  machine.transition('paused');
  status.textContent = message;
  updateScreen();
}

function resumeGame(): void {
  if (machine.state !== 'paused') return;
  pressedKeys.clear();
  machine.transition('battle');
  updateScreen();
  startLoop();
}

function finishBattle(): void {
  cancelAnimationFrame(frameId);
  pressedKeys.clear();
  if (!world) return;
  machine.transition('result');
  resultSummary.textContent = `150秒の試合を${world.tick}tickで完了しました。次の段階で罠と敗因の表示を追加します。`;
  resultHash.textContent = world.lastHash;
  updateScreen();
}

async function startBattle(): Promise<void> {
  const ready = await ensurePixi();
  if (!ready) return;
  world = createWorld(Date.now() >>> 0);
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  startLoop();
}

function returnToTitle(): void {
  cancelAnimationFrame(frameId);
  pressedKeys.clear();
  world = null;
  if (machine.state === 'battle' || machine.state === 'paused' || machine.state === 'result') {
    machine.transition('title');
  }
  updateScreen();
}

function bindEvents(): void {
  getElement<HTMLButtonElement>('start-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('retry-button').addEventListener('click', () => {
    machine.transition('title');
    updateScreen();
  });
  getElement<HTMLButtonElement>('pause-button').addEventListener('click', () => pauseGame());
  getElement<HTMLButtonElement>('resume-button').addEventListener('click', resumeGame);
  getElement<HTMLButtonElement>('pause-title-button').addEventListener('click', returnToTitle);
  getElement<HTMLButtonElement>('restart-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('result-title-button').addEventListener('click', returnToTitle);

  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd'].includes(event.key)) {
      event.preventDefault();
      pressedKeys.add(event.key);
    }
  });
  window.addEventListener('keyup', (event) => pressedKeys.delete(event.key));
  window.addEventListener('blur', () => {
    pressedKeys.clear();
    if (machine.state === 'battle') pauseGame('画面のフォーカスを失ったため停止しました。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      pressedKeys.clear();
      if (machine.state === 'battle') pauseGame('別の画面へ移ったため停止しました。');
    }
  });
  window.addEventListener('pagehide', () => {
    pressedKeys.clear();
    if (machine.state === 'battle') pauseGame('ページが隠れたため停止しました。');
  });
}

bindEvents();
updateScreen();
status.textContent = webglAvailable() ? '準備完了' : 'WebGLを確認できません';
if (!webglAvailable()) {
  machine.transition('unsupported');
  updateScreen();
}
