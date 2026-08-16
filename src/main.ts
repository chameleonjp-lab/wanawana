import { Application, Graphics } from 'pixi.js';
import './styles.css';
import { ContextRecovery } from './app/context-recovery.ts';
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
import { buildMatchReport, chainHeading, type MatchReport } from './core/result.ts';
import {
  ReplayRecorder,
  serializeReplayRecord,
  type MatchReplay,
} from './core/replay.ts';
import { getMapDefinition } from './core/maps.ts';
import {
  emptyMatchSummary,
  readMatchSummary,
  recordMatchSummary,
  serializeMatchSummary,
  type MatchSummary,
} from './core/progress.ts';
import {
  createMatchSettings,
  readMatchSettings,
  serializeMatchSettings,
  SETTINGS_STORAGE_KEY,
} from './core/settings.ts';
import {
  createMatchResume,
  readMatchResume,
  serializeMatchResume,
  type MatchResume,
} from './core/resume.ts';
import { advanceWorld, createWorld } from './core/sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  DEFAULT_TRAP_LOADOUT,
  DEFAULT_MAP_ID,
  type MapId,
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
const CONTEXT_RECOVERY_TIMEOUT_MS = 5_000;
const RESUME_STORAGE_KEY = 'wanawana:v1:resume';
const RESUME_SAVE_INTERVAL_TICKS = 2 * TICK_RATE;

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
const resultHistory = getElement<HTMLElement>('result-history');
const resultHash = getElement<HTMLElement>('result-hash');
const copyRecordButton = getElement<HTMLButtonElement>('copy-record-button');
const replayCopyStatus = getElement<HTMLElement>('replay-copy-status');
const trapPreview = getElement<HTMLElement>('trap-preview');
const inspectButton = getElement<HTMLButtonElement>('inspect-button');
const soundButton = getElement<HTMLButtonElement>('sound-button');
const difficultySelect = getElement<HTMLSelectElement>('difficulty-select');
const difficultyHelp = getElement<HTMLElement>('difficulty-help');
const difficultyValue = getElement<HTMLElement>('difficulty-value');
const loadoutSlot2 = getElement<HTMLSelectElement>('loadout-slot-2');
const loadoutSlot3 = getElement<HTMLSelectElement>('loadout-slot-3');
const loadoutHelp = getElement<HTMLElement>('loadout-help');
const mapSelect = getElement<HTMLSelectElement>('map-select');
const mapHelp = getElement<HTMLElement>('map-help');
const stageEyebrow = getElement<HTMLElement>('stage-eyebrow');
const battleHeading = getElement<HTMLElement>('battle-heading');
const careerSummaryValue = getElement<HTMLElement>('career-summary-value');
const careerSummaryNote = getElement<HTMLElement>('career-summary-note');
const clearCareerSummaryButton = getElement<HTMLButtonElement>('clear-career-summary');
const settingsNote = getElement<HTMLElement>('settings-note');
const resumeCard = getElement<HTMLElement>('resume-card');
const resumeSummary = getElement<HTMLElement>('resume-summary');
const resumeMatchButton = getElement<HTMLButtonElement>('resume-match-button');
const discardResumeButton = getElement<HTMLButtonElement>('discard-resume-button');
const controls = getElement<HTMLElement>('controls');

const SUMMARY_STORAGE_KEY = 'wanawana:v1:summary';
const BUILD_COMMIT = import.meta.env.VITE_BUILD_COMMIT ?? 'local';
let pixiApp: Application | null = null;
let world: WorldState | null = null;
let frameId = 0;
let lastFrameTime = 0;
let accumulator = 0;
let cpuDifficulty: CpuDifficulty = 'normal';
let selectedLoadout: TrapLoadout = DEFAULT_TRAP_LOADOUT;
let selectedMap: MapId = DEFAULT_MAP_ID;
let matchSummary: MatchSummary = emptyMatchSummary();
let summaryStorageAvailable = true;
let settingsStorageAvailable = true;
let resumeSnapshot: MatchResume | null = null;
let resumeStorageAvailable = true;
let summaryRecordedWorld: WorldState | null = null;
let replayRecorder: ReplayRecorder | null = null;
let completedReplay: MatchReplay | null = null;
const inputController = new InputController(controls);
const soundEngine = new SoundEngine();
const contextRecovery = new ContextRecovery();
let contextRecoveryTimer: number | null = null;

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
  updateResumePanel();
}

function updateSoundButton(): void {
  const state = soundEngine.state;
  soundButton.textContent = soundEngine.isEnabled
    ? '音: オン'
    : state === 'interrupted'
      ? '音: 中断中'
      : state === 'closed' || state === 'unavailable'
        ? '音: 利用不可'
        : '音: オフ';
  soundButton.setAttribute('aria-pressed', String(soundEngine.isEnabled));
  soundButton.title = state === 'interrupted'
    ? 'ブラウザが音声を中断しています。もう一度押すと再開を試します。'
    : state === 'closed' || state === 'unavailable'
      ? '音声を使えないため、音なしで試合を続けます。'
      : '音のオン・オフ';
}

function handleSoundStateChange(): void {
  updateSoundButton();
  if (machine.state !== 'battle') return;
  if (soundEngine.state === 'interrupted') {
    status.textContent = '音が中断されています。試合は続きます。';
  } else if (soundEngine.state === 'closed' || soundEngine.state === 'unavailable') {
    status.textContent = '音なしで試合を続けます。';
  }
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

function updateMapLabel(): void {
  const requested = mapSelect.value;
  const map = getMapDefinition(requested);
  selectedMap = map.id;
  mapSelect.value = map.id;
  mapHelp.textContent = `${map.subtitle}。開始位置、壁、舞台の色が固定されます。`;
  stageEyebrow.textContent = `試作ステージ ／ ${map.id}`;
  battleHeading.textContent = map.name;
}

function summaryHeadline(summary: MatchSummary): string {
  return `全${summary.matches}試合　${summary.wins}勝・${summary.losses}敗・${summary.draws}分`;
}

function summaryDetail(summary: MatchSummary): string {
  return `最高連鎖 ${summary.bestChain}段　罠設置 ${summary.trapsPlaced}　解除 ${summary.trapsDisarmed}`;
}

function updateCareerSummary(): void {
  careerSummaryValue.textContent = summaryHeadline(matchSummary);
  careerSummaryNote.textContent = summaryStorageAvailable
    ? `${summaryDetail(matchSummary)}（この端末に保存）`
    : `${summaryDetail(matchSummary)}（保存できないため、この画面を閉じると消えます）`;
  resultHistory.textContent = `${summaryHeadline(matchSummary)}。${summaryDetail(matchSummary)}`;
}

function updateSettingsNote(): void {
  settingsNote.textContent = settingsStorageAvailable
    ? '難度・舞台・罠ロードアウトは、この端末に保存されます。'
    : '設定を保存できない端末です。選んだ内容はこの画面を閉じると初期値へ戻ります。';
}

function loadMatchSettings(): void {
  try {
    const settings = readMatchSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
    difficultySelect.value = settings.difficulty;
    mapSelect.value = settings.mapId;
    loadoutSlot2.value = settings.loadout[1];
    loadoutSlot3.value = settings.loadout[2];
  } catch {
    settingsStorageAvailable = false;
  }
  updateSettingsNote();
}

function persistMatchSettings(): void {
  if (!settingsStorageAvailable) return;
  try {
    const settings = createMatchSettings(cpuDifficulty, selectedMap, selectedLoadout);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, serializeMatchSettings(settings));
  } catch {
    settingsStorageAvailable = false;
    updateSettingsNote();
  }
}

function updateResumePanel(): void {
  const visible = machine.state === 'title' && resumeSnapshot !== null;
  setVisible(resumeCard, visible);
  if (!resumeSnapshot) return;
  const map = getMapDefinition(resumeSnapshot.world.mapId);
  resumeSummary.textContent = `${map.name}・${resumeSnapshot.world.tick}tick（残り約${Math.max(0, 150 - resumeSnapshot.world.tick / TICK_RATE).toFixed(1)}秒）。${resumeStorageAvailable ? '30分以内なら再開できます。' : '保存を確認できません。'}`;
}

function loadMatchSummary(): void {
  try {
    matchSummary = readMatchSummary(window.localStorage.getItem(SUMMARY_STORAGE_KEY));
  } catch {
    summaryStorageAvailable = false;
    matchSummary = emptyMatchSummary();
  }
}

function persistMatchSummary(): void {
  if (!summaryStorageAvailable) return;
  try {
    window.localStorage.setItem(SUMMARY_STORAGE_KEY, serializeMatchSummary(matchSummary));
  } catch {
    summaryStorageAvailable = false;
  }
}

function clearMatchSummary(): void {
  if (!window.confirm('ワナワナの端末内戦績を削除しますか？')) return;
  try {
    window.localStorage.removeItem(SUMMARY_STORAGE_KEY);
    summaryStorageAvailable = true;
  } catch {
    summaryStorageAvailable = false;
  }
  matchSummary = emptyMatchSummary();
  updateCareerSummary();
}

function loadResumeSnapshot(): void {
  try {
    resumeSnapshot = readMatchResume(window.localStorage.getItem(RESUME_STORAGE_KEY), Date.now());
    if (!resumeSnapshot) window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    resumeStorageAvailable = false;
    resumeSnapshot = null;
  }
  updateResumePanel();
}

function clearResumeSnapshot(): void {
  try {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    resumeStorageAvailable = false;
  }
  resumeSnapshot = null;
  updateResumePanel();
}

function persistResumeSnapshot(): void {
  if (!resumeStorageAvailable || !world || machine.state === 'result' || world.phase !== 'battle') return;
  try {
    const snapshot = createMatchResume(world, cpuDifficulty, Date.now());
    window.localStorage.setItem(RESUME_STORAGE_KEY, serializeMatchResume(snapshot));
    resumeSnapshot = snapshot;
  } catch {
    resumeStorageAvailable = false;
  }
}

function recordFinishedMatch(report: MatchReport): void {
  if (!world || summaryRecordedWorld === world || !report.result) return;
  matchSummary = recordMatchSummary(matchSummary, {
    result: report.result,
    maxChain: report.maxChain,
    trapsPlaced: report.players[0].trapsPlaced,
    trapsDisarmed: report.players[0].trapsDisarmed,
  });
  summaryRecordedWorld = world;
  persistMatchSummary();
  updateCareerSummary();
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

function clearContextRecoveryTimer(): void {
  if (contextRecoveryTimer === null) return;
  window.clearTimeout(contextRecoveryTimer);
  contextRecoveryTimer = null;
}

function invalidateContextRecovery(message: string): void {
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  returnToTitle(message);
}

function handleWebglContextLost(event: Event): void {
  event.preventDefault();
  const outcome = contextRecovery.loseContext();
  if (!outcome.activeMatch) return;
  inputController.reset();
  soundEngine.suspend();
  if (outcome.invalid) {
    invalidateContextRecovery('描画領域を再び失ったため、この試合を無効にしました。');
    return;
  }
  clearContextRecoveryTimer();
  contextRecoveryTimer = window.setTimeout(() => {
    contextRecoveryTimer = null;
    if (contextRecovery.isPending) {
      invalidateContextRecovery('描画領域を5秒以内に復旧できなかったため、この試合を無効にしました。');
    }
  }, CONTEXT_RECOVERY_TIMEOUT_MS);
  if (machine.state === 'battle') {
    pauseGame('描画領域を失ったため停止しました。復旧を確認しています。');
  } else if (machine.state === 'paused') {
    status.textContent = '描画領域を失ったため、復旧を確認しています';
  }
}

function handleWebglContextRestored(): void {
  if (!contextRecovery.isPending) return;
  window.requestAnimationFrame(() => {
    if (!contextRecovery.isPending || !world || !pixiApp) return;
    try {
      drawWorld();
    } catch {
      return;
    }
    if (!contextRecovery.markRestored()) return;
    clearContextRecoveryTimer();
    updateScreen();
    status.textContent = '描画を復旧しました。再開するボタンを押してください。';
  });
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
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextlost', handleWebglContextLost);
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', handleWebglContextRestored);
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
  const map = getMapDefinition(world.mapId);
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
  background.rect(0, 0, width, height).fill({ color: map.backgroundColor });
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
  grid.stroke({ color: map.gridColor, alpha: 0.72, width: 1 });
  stage.addChild(grid);

  for (const obstacle of map.obstacleCells) {
    const wall = new Graphics();
    const x = offsetX + obstacle.cellX * pixelsPerCell;
    const y = offsetY + obstacle.cellY * pixelsPerCell;
    wall.roundRect(x + pixelsPerCell * 0.08, y + pixelsPerCell * 0.08, pixelsPerCell * 0.84, pixelsPerCell * 0.84, pixelsPerCell * 0.12)
      .fill({ color: map.accentColor, alpha: 0.32 })
      .stroke({ color: map.accentColor, alpha: 0.76, width: 2 });
    stage.addChild(wall);
  }

  const landmark = new Graphics();
  const centerX = offsetX + (ARENA_WIDTH_CELLS * pixelsPerCell) / 2;
  const centerY = offsetY + (ARENA_HEIGHT_CELLS * pixelsPerCell) / 2;
  const landmarkRadius = pixelsPerCell * 1.65;
  if (map.landmark === 'gear') {
    landmark.circle(centerX, centerY, landmarkRadius).stroke({ color: map.accentColor, alpha: 0.22, width: 3 });
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke * Math.PI / 4;
      landmark.moveTo(centerX + Math.cos(angle) * landmarkRadius * 1.18, centerY + Math.sin(angle) * landmarkRadius * 1.18)
        .lineTo(centerX + Math.cos(angle) * landmarkRadius * 1.55, centerY + Math.sin(angle) * landmarkRadius * 1.55);
    }
  } else if (map.landmark === 'crossroads') {
    landmark.moveTo(centerX, offsetY).lineTo(centerX, offsetY + ARENA_HEIGHT_CELLS * pixelsPerCell);
    landmark.moveTo(offsetX, centerY).lineTo(offsetX + ARENA_WIDTH_CELLS * pixelsPerCell, centerY);
    landmark.circle(centerX, centerY, landmarkRadius * 0.62).stroke({ color: map.accentColor, alpha: 0.24, width: 3 });
  } else {
    landmark.circle(centerX, centerY, landmarkRadius * 2.15).stroke({ color: map.accentColor, alpha: 0.25, width: 3 });
    landmark.circle(centerX, centerY, landmarkRadius * 0.72).stroke({ color: map.accentColor, alpha: 0.2, width: 2 });
  }
  landmark.stroke({ color: map.accentColor, alpha: 0.22, width: 2 });
  stage.addChild(landmark);

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
    replayRecorder?.recordTick(playerInput, cpuDecision.command, world);
    soundEngine.syncWorld(previousWorld, world);
    if (world.tick % RESUME_SAVE_INTERVAL_TICKS === 0 && world.phase === 'battle') persistResumeSnapshot();
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
  persistResumeSnapshot();
  machine.transition('paused');
  updateScreen();
  status.textContent = message;
}

async function resumeGame(): Promise<void> {
  if (machine.state !== 'paused') return;
  if (!contextRecovery.canResume) {
    status.textContent = '描画の復旧を待っています。';
    return;
  }
  contextRecovery.markResumed();
  const soundReady = await soundEngine.resume();
  if (!contextRecovery.canResume) {
    status.textContent = '描画の復旧を待っています。';
    return;
  }
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
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
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  clearResumeSnapshot();
  inputController.deactivate();
  if (!world) return;
  machine.transition('result');
  const report = buildMatchReport(world);
  completedReplay = replayRecorder?.finish(world) ?? null;
  replayRecorder = null;
  recordFinishedMatch(report);
  resultSummary.textContent = `${report.resultLabel}。${world.tick}tickで試合を終えました。`;
  renderResultDetails();
  resultHash.textContent = world.lastHash;
  copyRecordButton.disabled = completedReplay === null;
  replayCopyStatus.textContent = completedReplay
    ? '同じ記録を使えば、別の端末でも結果を検査できます。'
    : '対戦記録を作れませんでした。';
  updateScreen();
}

async function copyMatchRecord(): Promise<void> {
  if (!completedReplay) {
    replayCopyStatus.textContent = 'コピーできる対戦記録がありません。';
    return;
  }
  try {
    const serialized = serializeReplayRecord(completedReplay);
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(serialized);
    replayCopyStatus.textContent = `対戦記録をコピーしました（${Math.ceil(serialized.length / 1024)}KB）。`;
  } catch {
    replayCopyStatus.textContent = 'コピーできませんでした。安全な接続で再度お試しください。';
  }
}

async function resumeBattle(): Promise<void> {
  if (!resumeSnapshot) return;
  const snapshot = resumeSnapshot;
  selectedLoadout = normalizeTrapLoadout(snapshot.world.loadouts[0]);
  loadoutSlot2.value = selectedLoadout[1];
  loadoutSlot3.value = selectedLoadout[2];
  selectedMap = snapshot.world.mapId;
  mapSelect.value = selectedMap;
  difficultySelect.value = snapshot.difficulty;
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  persistMatchSettings();
  const soundReady = await soundEngine.resume();
  const ready = await ensurePixi();
  if (!ready || resumeSnapshot !== snapshot) return;

  clearResumeSnapshot();
  inputController.setTrapLoadout(selectedLoadout);
  contextRecovery.startMatch();
  world = snapshot.world;
  summaryRecordedWorld = null;
  replayRecorder = null;
  completedReplay = null;
  copyRecordButton.disabled = true;
  replayCopyStatus.textContent = '中断から再開した試合は、再現記録を作りません。';
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function discardResume(): void {
  clearResumeSnapshot();
  status.textContent = '中断した試合を破棄しました。';
}

async function startBattle(): Promise<void> {
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  persistMatchSettings();
  const soundReady = await soundEngine.resume();
  const ready = await ensurePixi();
  if (!ready) {
    soundEngine.suspend();
    updateSoundButton();
    return;
  }
  inputController.setTrapLoadout(selectedLoadout);
  clearResumeSnapshot();
  contextRecovery.startMatch();
  world = createWorld(Date.now() >>> 0, selectedLoadout, selectedLoadout, selectedMap);
  summaryRecordedWorld = null;
  completedReplay = null;
  replayRecorder = new ReplayRecorder(world, { buildCommit: BUILD_COMMIT });
  copyRecordButton.disabled = true;
  replayCopyStatus.textContent = '';
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function returnToTitle(message = ''): void {
  cancelAnimationFrame(frameId);
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  clearResumeSnapshot();
  inputController.deactivate();
  inputController.setTrapLoadout(null);
  soundEngine.suspend();
  world = null;
  replayRecorder = null;
  completedReplay = null;
  if (machine.state === 'battle' || machine.state === 'paused' || machine.state === 'result') {
    machine.transition('title');
  }
  updateScreen();
  if (message) status.textContent = message;
}

function bindEvents(): void {
  getElement<HTMLButtonElement>('start-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('retry-button').addEventListener('click', () => {
    machine.transition('title');
    updateScreen();
  });
  getElement<HTMLButtonElement>('pause-button').addEventListener('click', () => pauseGame());
  getElement<HTMLButtonElement>('resume-button').addEventListener('click', () => void resumeGame());
  soundEngine.addStateListener(handleSoundStateChange);
  soundButton.addEventListener('click', () => {
    void soundEngine.toggle().then((enabled) => {
      updateSoundButton();
      if (!enabled && machine.state === 'battle') status.textContent = '音なしで試合を続けます。';
    });
  });
  clearCareerSummaryButton.addEventListener('click', clearMatchSummary);
  resumeMatchButton.addEventListener('click', () => void resumeBattle());
  discardResumeButton.addEventListener('click', discardResume);
  difficultySelect.addEventListener('change', () => {
    updateDifficultyLabel();
    persistMatchSettings();
  });
  loadoutSlot2.addEventListener('change', () => {
    updateLoadoutLabel();
    persistMatchSettings();
  });
  loadoutSlot3.addEventListener('change', () => {
    updateLoadoutLabel();
    persistMatchSettings();
  });
  mapSelect.addEventListener('change', () => {
    updateMapLabel();
    persistMatchSettings();
  });
  getElement<HTMLButtonElement>('pause-title-button').addEventListener('click', () => returnToTitle());
  getElement<HTMLButtonElement>('restart-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('result-title-button').addEventListener('click', () => returnToTitle());
  copyRecordButton.addEventListener('click', () => void copyMatchRecord());

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
loadMatchSummary();
loadMatchSettings();
loadResumeSnapshot();
updateScreen();
updateSoundButton();
updateDifficultyLabel();
updateLoadoutLabel();
updateMapLabel();
updateCareerSummary();
status.textContent = webglAvailable() ? '準備完了' : 'WebGLを確認できません';
if (!webglAvailable()) {
  machine.transition('unsupported');
  updateScreen();
}
