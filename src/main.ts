import { Application, Graphics } from 'pixi.js';
import './styles.css';
import { AppStateMachine } from './app/state.ts';
import { SoundEngine } from './audio/sound.ts';
import { chooseCpuDecision } from './core/ai.ts';
import {
  getCpuDifficultyProfile,
  normalizeCpuDifficulty,
} from './core/difficulty.ts';
import {
  cellCenterUnits,
  cellToPixels,
  INVESTIGATE_RADIUS_UNITS,
  isTrapKind,
  MOYA_RADIUS_UNITS,
  normalizeTrapLoadout,
  snapToCell,
} from './core/fixed.ts';
import { buildMatchReport, chainHeading } from './core/result.ts';
import { advanceWorld, createWorld } from './core/sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  DEFAULT_TRAP_LOADOUT,
  TICK_RATE,
  type CpuDifficulty,
  type InputCommand,
  type TrapKind,
  type TrapLoadout,
  type WorldState,
} from './core/types.ts';
import { InputController } from './input/controller.ts';

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
const gearValue = getElement<HTMLElement>('gear-value');
const tickValue = getElement<HTMLElement>('tick-value');
const resultSummary = getElement<HTMLElement>('result-summary');
const resultDetails = getElement<HTMLElement>('result-details');
const resultHash = getElement<HTMLElement>('result-hash');
const trapPreview = getElement<HTMLElement>('trap-preview');
const inspectButton = getElement<HTMLButtonElement>('inspect-button');
const soundButton = getElement<HTMLButtonElement>('sound-button');
const difficultySelect = getElement<HTMLSelectElement>('difficulty-select');
const difficultyHelp = getElement<HTMLElement>('difficulty-help');
const difficultyValue = getElement<HTMLElement>('difficulty-value');
const loadoutSlot2 = getElement<HTMLSelectElement>('loadout-slot-2');
const loadoutSlot3 = getElement<HTMLSelectElement>('loadout-slot-3');
const loadoutHelp = getElement<HTMLElement>('loadout-help');
const controls = getElement<HTMLElement>('controls');

let pixiApp: Application | null = null;
let world: WorldState | null = null;
let frameId = 0;
let lastFrameTime = 0;
let accumulator = 0;
let cpuDifficulty: CpuDifficulty = 'normal';
let selectedLoadout: TrapLoadout = DEFAULT_TRAP_LOADOUT;
const inputController = new InputController(controls);
const soundEngine = new SoundEngine();

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
  updateTrapButtons();
}

function updateSoundButton(): void {
  soundButton.textContent = soundEngine.isEnabled ? '音: オン' : '音: オフ';
  soundButton.setAttribute('aria-pressed', String(soundEngine.isEnabled));
}

function updateDifficultyLabel(): void {
  cpuDifficulty = normalizeCpuDifficulty(difficultySelect.value);
  const profile = getCpuDifficultyProfile(cpuDifficulty);
  difficultySelect.value = profile.id;
  difficultyValue.textContent = profile.label;
  difficultyHelp.textContent = cpuDifficulty === 'easy'
    ? '反応がゆっくりで、射撃を外すことがあります。'
    : cpuDifficulty === 'hard'
      ? '危険への反応が早く、5種類の罠を連鎖に使います。'
      : '反応、射撃の正確さ、連鎖の考え方が標準です。';
}

function updateLoadoutLabel(): void {
  const requested: TrapKind[] = [
    'bounce',
    isTrapKind(loadoutSlot2.value) ? loadoutSlot2.value : 'shock',
    isTrapKind(loadoutSlot3.value) ? loadoutSlot3.value : 'hatch',
  ];
  selectedLoadout = normalizeTrapLoadout(requested);
  loadoutSlot2.value = selectedLoadout[1];
  loadoutSlot3.value = selectedLoadout[2];
  loadoutHelp.textContent = `試合中は${selectedLoadout.map(trapName).join('・')}だけ設置できます。`;
}

function updateTrapButtons(): void {
  const active = machine.state === 'battle';
  const buttons = controls.querySelectorAll<HTMLButtonElement>('[data-input-role^="trap-"]');
  for (const button of buttons) {
    const rawKind = button.dataset.inputRole?.slice(5);
    const enabled = !active || (isTrapKind(rawKind) && selectedLoadout.includes(rawKind));
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
  }
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
  if (world && inputController.previewTrap) {
    inputController.capturePreviewCell(
      snapToCell(world.players[0].x, ARENA_WIDTH_CELLS),
      snapToCell(world.players[0].y, ARENA_HEIGHT_CELLS),
    );
  }
  return inputController.readCommand();
}

function drawWorld(): void {
  if (!pixiApp || !world) return;
  const width = Math.max(1, arena.clientWidth);
  const height = Math.max(1, arena.clientHeight);
  const pixelsPerCell = Math.min(width / ARENA_WIDTH_CELLS, height / ARENA_HEIGHT_CELLS);
  const offsetX = (width - pixelsPerCell * ARENA_WIDTH_CELLS) / 2;
  const offsetY = (height - pixelsPerCell * ARENA_HEIGHT_CELLS) / 2;
  const stage = pixiApp.stage;
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true });
  }

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

  for (const trap of world.traps) {
    if (trap.owner === 1 && !trap.discoveredBy[0]) continue;
    const x = offsetX + cellToPixels(cellCenterUnits(trap.cellX), pixelsPerCell);
    const y = offsetY + cellToPixels(cellCenterUnits(trap.cellY), pixelsPerCell);
    const color = trapColor(trap.kind);
    const marker = new Graphics();
    const alpha = trap.armingTicks > 0 ? 0.45 : 0.9;
    marker.roundRect(x - pixelsPerCell * 0.28, y - pixelsPerCell * 0.28, pixelsPerCell * 0.56, pixelsPerCell * 0.56, pixelsPerCell * 0.12)
      .fill({ color, alpha })
      .stroke({ color: 0xffffff, alpha: 0.7, width: 1.5 });
    stage.addChild(marker);
    if (trap.kind === 'bomb' && (trap.triggerTicks ?? 0) > 0) {
      const fuse = new Graphics();
      fuse.circle(x, y, pixelsPerCell * 0.38)
        .stroke({ color: 0xff9b54, alpha: 0.95, width: 2 });
      stage.addChild(fuse);
    }
    if (trap.kind === 'moya' && (trap.effectTicks ?? 0) > 0) {
      const gas = new Graphics();
      gas.circle(x, y, cellToPixels(MOYA_RADIUS_UNITS, pixelsPerCell))
        .stroke({ color: 0x9ad7a5, alpha: 0.34, width: 2 });
      stage.addChild(gas);
    }
  }

  const player = world.players[0];
  const dangerCue = hasDangerCue(player, world.traps);
  if (dangerCue) {
    const warning = new Graphics();
    const warningX = offsetX + cellToPixels(player.x, pixelsPerCell);
    const warningY = offsetY + cellToPixels(player.y, pixelsPerCell);
    warning.circle(warningX, warningY, Math.max(18, pixelsPerCell * 0.48))
      .stroke({ color: 0xffdc73, alpha: 0.9, width: 2 });
    stage.addChild(warning);
  }
  const previewCellX = player.placement?.cellX ?? inputController.previewCell?.cellX ?? snapToCell(player.x, ARENA_WIDTH_CELLS);
  const previewCellY = player.placement?.cellY ?? inputController.previewCell?.cellY ?? snapToCell(player.y, ARENA_HEIGHT_CELLS);
  if (inputController.previewTrap || player.placement) {
    const preview = new Graphics();
    const previewX = offsetX + cellToPixels(cellCenterUnits(previewCellX), pixelsPerCell);
    const previewY = offsetY + cellToPixels(cellCenterUnits(previewCellY), pixelsPerCell);
    preview.roundRect(previewX - pixelsPerCell * 0.38, previewY - pixelsPerCell * 0.38, pixelsPerCell * 0.76, pixelsPerCell * 0.76, pixelsPerCell * 0.14)
      .stroke({ color: 0xf2b8ff, alpha: 0.9, width: 2 });
    stage.addChild(preview);
  }

  for (const event of world.events) {
    const age = world.tick - event.tick;
    if (age < 0 || age > 30) continue;
    const eventX = offsetX + cellToPixels(event.x, pixelsPerCell);
    const eventY = offsetY + cellToPixels(event.y, pixelsPerCell);
    const marker = new Graphics();
    const color = trapColor(event.kind);
    marker.circle(eventX, eventY, Math.max(10, pixelsPerCell * (0.2 + age / 180)))
      .stroke({ color, alpha: Math.max(0.2, 1 - age / 30), width: 2 });
    stage.addChild(marker);
    if (age <= 12) {
      const burst = new Graphics();
      const burstAlpha = Math.max(0.08, 0.7 - age / 18);
      const burstRadius = pixelsPerCell * (0.28 + age / 60);
      burst.circle(eventX, eventY, burstRadius).stroke({ color, alpha: burstAlpha, width: 2 });
      for (let ray = 0; ray < 4; ray += 1) {
        const angle = ray * Math.PI / 2;
        const startRadius = burstRadius * 1.25;
        const endRadius = burstRadius * 1.8;
        burst.moveTo(eventX + Math.cos(angle) * startRadius, eventY + Math.sin(angle) * startRadius)
          .lineTo(eventX + Math.cos(angle) * endRadius, eventY + Math.sin(angle) * endRadius);
      }
      burst.stroke({ color, alpha: burstAlpha, width: 2 });
      stage.addChild(burst);
    }
  }

  for (const player of world.players) {
    const x = offsetX + cellToPixels(player.x, pixelsPerCell);
    const y = offsetY + cellToPixels(player.y, pixelsPerCell);
    const size = Math.max(18, pixelsPerCell * 0.64);
    const color = player.id === 0 ? 0xffd37a : 0xd59aff;
    const token = new Graphics();
    const alpha = player.disabledTicks > 0 ? 0.35 : 1;
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).fill({ color, alpha });
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).stroke({ color: 0xffffff, alpha: 0.85, width: 2 });
    stage.addChild(token);
  }

  for (const shot of world.shots) {
    const x = offsetX + cellToPixels(shot.x, pixelsPerCell);
    const y = offsetY + cellToPixels(shot.y, pixelsPerCell);
    const projectile = new Graphics();
    projectile.circle(x, y, Math.max(4, pixelsPerCell * 0.12)).fill({ color: 0xfff2b0 });
    stage.addChild(projectile);
  }

  pixiApp.renderer.render(stage);
}

function updateHud(): void {
  if (!world) return;
  const currentWorld = world;
  timeValue.textContent = Math.max(0, (150 - world.tick / 60)).toFixed(1);
  playerHp.textContent = String(world.players[0].hp);
  cpuHp.textContent = String(world.players[1].hp);
  gearValue.textContent = String(world.players[0].gear);
  tickValue.textContent = String(world.tick);
  const dangerCue = hasDangerCue(world.players[0], world.traps);
  inspectButton.classList.toggle('is-unavailable', !dangerCue);
  inspectButton.setAttribute('aria-disabled', String(!dangerCue));
  if (inputController.previewTrap) {
    trapPreview.textContent = `${trapName(inputController.previewTrap)}を足元へ予告中。離して設置`;
  } else if (world.players[0].placement) {
    trapPreview.textContent = `${trapName(world.players[0].placement.kind)}を設置中…`;
  } else if (world.players[0].investigation) {
    trapPreview.textContent = world.players[0].investigation.mode === 'reveal' ? '調査中…' : '解除中…';
  } else if (dangerCue) {
    trapPreview.textContent = '近くに危険な気配。方向は不明';
  } else {
    const recentEvent = [...currentWorld.events].reverse().find((event) => currentWorld.tick - event.tick <= 18);
    if (recentEvent) {
      trapPreview.textContent = `${trapName(recentEvent.kind)}が発動。連鎖 ${recentEvent.chainLength}`;
    } else {
      trapPreview.textContent = '罠札を押して足元へ予告';
    }
  }
}

function hasDangerCue(
  player: WorldState['players'][number],
  traps: WorldState['traps'],
): boolean {
  const radiusSquared = INVESTIGATE_RADIUS_UNITS * INVESTIGATE_RADIUS_UNITS;
  return traps.some((trap) => {
    if (trap.owner === player.id || trap.armingTicks > 0 || trap.discoveredBy[player.id]) return false;
    const dx = player.x - cellCenterUnits(trap.cellX);
    const dy = player.y - cellCenterUnits(trap.cellY);
    return dx * dx + dy * dy <= radiusSquared;
  });
}

function trapColor(kind: TrapKind): number {
  if (kind === 'bounce') return 0x8cbdff;
  if (kind === 'shock') return 0xffdc73;
  if (kind === 'hatch') return 0xff99c8;
  if (kind === 'bomb') return 0xff9b54;
  return 0x9ad7a5;
}

function trapName(kind: TrapKind): string {
  if (kind === 'bounce') return 'ハネ板';
  if (kind === 'shock') return 'ビリビリ盤';
  if (kind === 'hatch') return 'パカット床';
  if (kind === 'bomb') return 'ポン玉';
  return 'モヤびん';
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
    const playerInput = readInput();
    const cpuDecision = chooseCpuDecision(world, cpuDifficulty);
    const previousWorld = world;
    world = advanceWorld(world, playerInput, cpuDecision.command);
    soundEngine.syncWorld(previousWorld, world);
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
  inputController.deactivate();
  soundEngine.suspend();
  machine.transition('paused');
  status.textContent = message;
  updateScreen();
}

function resumeGame(): void {
  if (machine.state !== 'paused') return;
  inputController.activate();
  void soundEngine.resume().then(updateSoundButton);
  machine.transition('battle');
  updateScreen();
  startLoop();
}

function appendStat(parent: HTMLElement, label: string, value: string): void {
  const item = document.createElement('p');
  item.className = 'result-stat';
  item.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  item.append(strong);
  parent.append(item);
}

function renderResultDetails(): void {
  if (!world) return;
  const report = buildMatchReport(world);
  resultDetails.replaceChildren();

  const reason = document.createElement('p');
  reason.className = 'result-reason';
  reason.textContent = report.resultReason;
  resultDetails.append(reason);

  const statGrid = document.createElement('div');
  statGrid.className = 'result-stat-grid';
  appendStat(statGrid, 'あなたの体力', String(report.players[0].hp));
  appendStat(statGrid, 'CPUの体力', String(report.players[1].hp));
  appendStat(statGrid, '試合時間', `${(report.durationTicks / TICK_RATE).toFixed(1)}秒`);
  appendStat(statGrid, '最大連鎖', `${report.maxChain}段`);
  appendStat(statGrid, 'あなたの罠 / 解除', `${report.players[0].trapsPlaced} / ${report.players[0].trapsDisarmed}`);
  appendStat(statGrid, 'CPUの罠 / 解除', `${report.players[1].trapsPlaced} / ${report.players[1].trapsDisarmed}`);
  resultDetails.append(statGrid);

  const chainTitle = document.createElement('p');
  chainTitle.className = 'result-reason';
  chainTitle.textContent = `罠の記録（${report.eventCount}発動・${report.chains.length}連鎖）`;
  resultDetails.append(chainTitle);

  if (report.chains.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'result-chain-empty';
    empty.textContent = 'この試合では罠の連鎖はありませんでした。';
    resultDetails.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'result-chains';
  const chains = report.chains.slice(-12);
  for (const chain of chains) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.className = 'result-chain-heading';
    heading.textContent = chainHeading(chain);
    item.append(heading);
    const description = document.createElement('span');
    description.textContent = `${chain.description}${chain.damage > 0 ? `（合計${chain.damage}ダメージ）` : ''}`;
    item.append(description);
    list.append(item);
  }
  resultDetails.append(list);
}

function finishBattle(): void {
  cancelAnimationFrame(frameId);
  inputController.deactivate();
  if (!world) return;
  machine.transition('result');
  const report = buildMatchReport(world);
  resultSummary.textContent = `${report.resultLabel}。${world.tick}tickで試合を終えました。`;
  renderResultDetails();
  resultHash.textContent = world.lastHash;
  updateScreen();
}

async function startBattle(): Promise<void> {
  updateDifficultyLabel();
  updateLoadoutLabel();
  void soundEngine.resume().then(updateSoundButton);
  const ready = await ensurePixi();
  if (!ready) {
    soundEngine.suspend();
    updateSoundButton();
    return;
  }
  inputController.setTrapLoadout(selectedLoadout);
  world = createWorld(Date.now() >>> 0, selectedLoadout, selectedLoadout);
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  startLoop();
}

function returnToTitle(): void {
  cancelAnimationFrame(frameId);
  inputController.deactivate();
  inputController.setTrapLoadout(null);
  soundEngine.suspend();
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
  soundButton.addEventListener('click', () => void soundEngine.toggle().then(updateSoundButton));
  difficultySelect.addEventListener('change', updateDifficultyLabel);
  loadoutSlot2.addEventListener('change', updateLoadoutLabel);
  loadoutSlot3.addEventListener('change', updateLoadoutLabel);
  getElement<HTMLButtonElement>('pause-title-button').addEventListener('click', returnToTitle);
  getElement<HTMLButtonElement>('restart-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('result-title-button').addEventListener('click', returnToTitle);

  window.addEventListener('blur', () => {
    inputController.reset();
    if (machine.state === 'battle') pauseGame('画面のフォーカスを失ったため停止しました。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      inputController.reset();
      if (machine.state === 'battle') pauseGame('別の画面へ移ったため停止しました。');
    }
  });
  window.addEventListener('pagehide', () => {
    inputController.reset();
    if (machine.state === 'battle') pauseGame('ページが隠れたため停止しました。');
  });
  window.addEventListener('orientationchange', () => {
    inputController.reset();
    if (machine.state === 'battle') pauseGame('縦向きに戻してから再開してください。');
  });
}

bindEvents();
updateScreen();
updateSoundButton();
updateDifficultyLabel();
updateLoadoutLabel();
status.textContent = webglAvailable() ? '準備完了' : 'WebGLを確認できません';
if (!webglAvailable()) {
  machine.transition('unsupported');
  updateScreen();
}
