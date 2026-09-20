import './style.css';
import type Phaser from 'phaser';
import { Battle } from './core/battle.ts';
import type { Enemy } from './core/battle.ts';
import { LEVELS, UNITS, ENEMIES, unitById, isBomb } from './core/content.ts';
import type { UnitId } from './core/content.ts';
import { format } from './core/math.ts';
import { createGarden, GardenScene } from './game/scene.ts';
import type { Selection } from './game/scene.ts';
import { portrait, enemyPortrait, heroArt, loadArtwork } from './game/art.ts';
import { Sound } from './game/sound.ts';
import { ApiError, request } from './ui/api.ts';
import type { SessionInfo, LevelProgress, CompletionPayload } from './shared/api.ts';

interface PendingCompletion extends CompletionPayload {
  submissionId: string;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const sound = new Sound();
let session: SessionInfo = { user: null, progress: [] };
let game: Phaser.Game | null = null,
  scene: GardenScene | null = null,
  battle: Battle | null = null;
let authMode: 'login' | 'register' = 'login',
  authBusy = false,
  toastTimer: ReturnType<typeof setTimeout> | undefined;
let selected: Selection = 'derivative',
  libraryTab = 'units';
let saving: Battle | null = null;
let artworkReady = false;
const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const stars = (count: number): string =>
  `<span class="stars" aria-label="${count}颗星">${'★'.repeat(count)}<span>${'☆'.repeat(3 - count)}</span></span>`;
const nextLevel = (): number =>
  Math.min(LEVELS.length, Math.max(0, ...session.progress.map((p) => p.level)) + 1);
const minute = (seconds: number): string =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
const pendingKey = (owner = session): string =>
  `fg:pending:${owner.user?.id}:${owner.user?.username}`;

function header(): string {
  return `<header class="topbar"><a class="brand" href="#" data-action="home" aria-label="植物大战僵尸—函数版首页"><span class="brand-mark">D<i></i></span><span><b>植物大战僵尸<span class="brand-edition">函数版</span></b><small>FUNCTION GARDEN · 守住你的数学花园</small></span></a><nav class="top-actions"><button class="text-button" data-action="library"${artworkReady ? '' : ' disabled'}>函数手册 <span class="key-hint">?</span></button><button class="round-button" data-action="sound" aria-label="${sound.enabled ? '关闭音效' : '开启音效'}" title="音效">${sound.enabled ? '♪' : '♩'}</button>${session.user ? `<span class="user-chip"><i></i>${escape(session.user.username)}</span><button class="text-button logout" data-action="logout">退出</button>` : '<span class="edition">十关庭院挑战</span>'}</nav></header>`;
}
function overlays(): string {
  return '<div class="toast" id="toast" role="status" aria-live="polite"></div><dialog id="modal" aria-label="游戏对话框"></dialog>';
}
function notify(message: string): void {
  const target = document.querySelector<HTMLElement>('#toast');
  if (!target) return;
  clearTimeout(toastTimer);
  target.textContent = message;
  target.classList.add('visible');
  toastTimer = setTimeout(() => target.classList.remove('visible'), 3400);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生了意外错误，请重试。';
}
function modal(content: string, kind = ''): void {
  const dialog = document.querySelector<HTMLDialogElement>('#modal')!;
  dialog.className = kind;
  dialog.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>('button,input')?.focus();
}
function closeModal(): void {
  document.querySelector<HTMLDialogElement>('#modal')?.close();
}
function stopGame(): void {
  battle = null;
  scene = null;
  if (game) {
    game.destroy(true);
    game = null;
  }
}
function shell(content: string): void {
  clearTimeout(toastTimer);
  app.innerHTML = `<div class="app-shell">${header()}${content}<footer class="site-footer"><span>每一道函数，都有自己的解法。</span><span>FUNCTION GARDEN / v0.1</span></footer></div>${overlays()}`;
}

function showAuth(): void {
  stopGame();
  shell(
    `<main class="auth-layout"><section class="welcome-panel"><span class="eyebrow light">THE GARDEN NEEDS YOU</span><h1>植物大战僵尸<br><span>函数版</span></h1><p>种下求导，布好函数门。<br>让来势汹汹的函数，统统归于常数。</p><div class="welcome-pills"><span>5 × 9 棋盘</span><span>7 种运算 + 3 档炸弹</span><span>多种解法</span></div><div class="welcome-art"><canvas id="welcome-canvas" aria-label="求导塔与对数门守卫花园"></canvas></div><span class="welcome-scribble">f(x) → c</span></section><section class="auth-card"><span class="eyebrow">YOUR GARDEN AWAITS</span><h2>${authMode === 'login' ? '欢迎回到花园' : '开启你的第一场演算'}</h2><p class="muted">${authMode === 'login' ? '登录后，继续上一次的闯关进度。' : '创建账号，记录你的每一次突破。'}</p><div class="auth-tabs" role="tablist" aria-label="账号操作"><button role="tab" aria-selected="${authMode === 'login'}" data-action="auth-login">登录</button><button role="tab" aria-selected="${authMode === 'register'}" data-action="auth-register">注册</button></div><form id="auth-form"><label class="field">用户名<input name="username" autocomplete="username" placeholder="给你的花园取一个名字" minlength="2" maxlength="20" required aria-describedby="username-hint"><small id="username-hint">2–20 个汉字、字母、数字、下划线或短横线</small></label><label class="field">密码<div class="password-wrap"><input name="password" type="password" autocomplete="${authMode === 'login' ? 'current-password' : 'new-password'}" placeholder="至少 8 个字符" minlength="8" maxlength="128" required><button type="button" class="password-toggle" data-action="password">显示</button></div></label><div id="auth-error" class="form-error" role="alert"></div><button class="button primary wide" type="submit">${authMode === 'login' ? '进入花园' : '创建账号并开始'} <span>→</span></button></form><div class="auth-note"><span class="tiny-leaf">✦</span> 通关进度自动保存到你的账号</div></section></main>`,
  );
  heroArt(document.querySelector<HTMLCanvasElement>('#welcome-canvas')!);
  document.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitAuth(event.currentTarget as HTMLFormElement);
  });
}
async function submitAuth(form: HTMLFormElement): Promise<void> {
  if (authBusy) return;
  authBusy = true;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!,
    error = form.querySelector<HTMLElement>('#auth-error')!;
  button.disabled = true;
  error.textContent = '';
  const data = new FormData(form);
  button.textContent = authMode === 'login' ? '正在打开花园…' : '正在创建账号…';
  try {
    session = await request<SessionInfo>(`/api/${authMode}`, {
      username: data.get('username'),
      password: data.get('password'),
    });
    await retryPending();
    showLobby();
  } catch (e) {
    error.textContent = errorMessage(e);
    button.textContent = authMode === 'login' ? '进入花园 →' : '创建账号并开始 →';
  } finally {
    authBusy = false;
    button.disabled = false;
  }
}
function readPending(owner: SessionInfo): PendingCompletion[] {
  const user = owner.user,
    stored = localStorage.getItem(pendingKey(owner));
  if (!user || !stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  // Accept the previous single-entry format; discard invalidated account revisions.
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter((value): value is PendingCompletion => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<PendingCompletion>;
    return (
      payload.userId === user.id &&
      payload.progressRevision === user.progressRevision &&
      typeof payload.submissionId === 'string' &&
      payload.submissionId.length > 0 &&
      typeof payload.level === 'number' &&
      LEVELS.some((level) => level.id === payload.level) &&
      typeof payload.stars === 'number' &&
      Number.isInteger(payload.stars) &&
      payload.stars >= 1 &&
      payload.stars <= 3 &&
      typeof payload.seconds === 'number' &&
      Number.isFinite(payload.seconds) &&
      payload.seconds >= 1 &&
      payload.seconds <= 86400
    );
  });
}
function writePending(owner: SessionInfo, entries: PendingCompletion[]): void {
  if (entries.length) localStorage.setItem(pendingKey(owner), JSON.stringify(entries));
  else localStorage.removeItem(pendingKey(owner));
}
async function retryPending(): Promise<void> {
  const owner = session;
  if (!owner.user) return;
  const entries = readPending(owner).sort((a, b) => a.level - b.level);
  writePending(owner, entries);
  for (const payload of entries) {
    if (session !== owner) return;
    try {
      await submitProgress(owner, payload);
    } catch (error) {
      // Keep unsent results on connection/auth failures; skip definitively rejected entries.
      if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 409)) return;
    }
  }
}
async function submitProgress(owner: SessionInfo, payload: PendingCompletion): Promise<boolean> {
  const isCurrent = (): boolean =>
    session === owner &&
    readPending(owner).some(
      (entry) => entry.level === payload.level && entry.submissionId === payload.submissionId,
    );
  const discard = (): void =>
    writePending(
      owner,
      readPending(owner).filter((entry) => entry.submissionId !== payload.submissionId),
    );
  if (!isCurrent()) return false;
  try {
    const result = await request<{ progress: LevelProgress[] }>('/api/progress/complete', payload);
    if (!isCurrent()) return false;
    // Requests for different levels can return out of order: never regress confirmed bests.
    const progress = new Map(owner.progress.map((entry) => [entry.level, entry]));
    for (const entry of result.progress) {
      const previous = progress.get(entry.level);
      progress.set(
        entry.level,
        previous
          ? {
              level: entry.level,
              stars: Math.max(previous.stars, entry.stars),
              bestSeconds: Math.min(previous.bestSeconds, entry.bestSeconds),
            }
          : entry,
      );
    }
    owner.progress = [...progress.values()].sort((a, b) => a.level - b.level);
    discard();
    return true;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 409) && isCurrent())
      discard();
    throw error;
  }
}
function showLobby(): void {
  stopGame();
  const next = nextLevel(),
    totalStars = session.progress.reduce((s, p) => s + p.stars, 0);
  shell(
    `<main class="lobby"><div class="lobby-title"><div><span class="eyebrow">YOUR GARDEN · 十关挑战</span><h1>庭院防线，等你来守。</h1></div><span class="progress-pill">✦ <b>${totalStars}</b> / ${LEVELS.length * 3} 星</span></div><section class="chapter-hero"><div class="chapter-copy"><span class="chapter-label">CHAPTER ${String(next).padStart(2, '0')} <i></i> ${session.progress.length === LEVELS.length ? '重访你的花园' : '下一段旅程'}</span><h2>${LEVELS[next - 1]!.title}</h2><p>${LEVELS[next - 1]!.description}</p><button class="button primary" data-action="level" data-level="${next}">开始闯关 <span>→</span></button><small>可暂停思考与布阵 · 0 &lt; x &lt; 1</small></div><div class="chapter-art"><canvas id="lobby-canvas" aria-label="手绘数学庭院"></canvas></div></section><div class="section-heading"><h2>你的演算旅程</h2><span>完成上一章，解锁新的运算。</span></div><section class="level-grid">${LEVELS.map(
      (level) => {
        const record = session.progress.find((p) => p.level === level.id),
          locked = level.id > next;
        return `<button class="level-card ${locked ? 'locked' : ''}" data-action="level" data-level="${level.id}" ${locked ? 'disabled' : ''}><div class="level-card-top"><span class="level-number">${String(level.id).padStart(2, '0')}</span>${record ? stars(record.stars) : `<span class="status-tag">${locked ? '尚未解锁' : '等待挑战'}</span>`}</div><div class="level-art"><img src="${portrait(level.portrait)}" alt=""><span class="level-equation">${escape(level.formula)}</span></div><h3>${level.title}</h3><p>${level.subtitle}</p><div class="level-card-bottom"><span>${level.waves} 波入侵${record ? ` · 最佳 ${minute(record.bestSeconds)}` : ''}</span><span>${locked ? '⌁' : '↗'}</span></div></button>`;
      },
    ).join(
      '',
    )}</section><section class="notebook-strip"><div class="mini-portraits">${['derivative', 'square', 'reciprocal'].map((id) => `<img src="${portrait(id as UnitId)}" alt="">`).join('')}</div><div><h3>认识你的运算伙伴</h3><p>求导是火力，变换是钥匙。先看懂，再出手。</p></div><button class="button secondary" data-action="library">打开函数手册 ↗</button></section></main>`,
  );
  heroArt(document.querySelector<HTMLCanvasElement>('#lobby-canvas')!);
  if (localStorage.getItem(pendingKey())) notify('有成绩等待同步，下次登录时会自动重试。');
}

function startBattle(levelId: number, seed?: number): void {
  if (levelId > nextLevel()) {
    notify('请先完成前面的关卡。');
    return;
  }
  closeModal();
  stopGame();
  selected = 'derivative';
  saving = null;
  const model = new Battle(levelId, seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!);
  battle = model;
  const level = model.level;
  shell(
    `<main class="battle-page"><div class="battle-heading"><div><button class="back-button" data-action="home">← 返回花园</button><h1><span>${String(level.id).padStart(2, '0')}</span> ${level.title}</h1></div><div class="battle-utilities"><button class="button secondary compact" data-action="restart">重新开始</button><button class="button secondary compact" data-action="library">作战手册</button></div></div><p class="battle-pause-tip">来不及应对？先按空格或点击“暂停”，布置好函数门和炮台，再继续战斗。</p><section class="battle-hud"><div class="energy-display"><span class="energy-symbol">✦</span><span><small>能量</small><strong id="energy">${model.energy}</strong></span><em>+${level.income}/秒</em></div><div class="hud-divider"></div><div class="hud-stat"><small>基地生命</small><span id="lives" class="hearts">♥ ♥ ♥</span></div><div class="hud-stat wave-stat"><small>入侵波次</small><span><b id="wave">准备阶段</b><small id="wave-hint">第一波：A / C / E 行</small></span></div><div class="hud-stat timer-stat"><small>演算时间</small><b id="timer">00:00</b></div><button class="button primary compact" id="pause-button" data-action="pause">准备就绪，开始 →</button></section><section class="seed-tray" aria-label="运算卡牌">${UNITS.filter(
      (u) => u.level <= levelId,
    )
      .map(
        (u) =>
          `<button class="seed-card ${u.id === 'derivative' ? 'selected' : ''}" data-action="select-unit" data-unit="${u.id}" aria-pressed="${u.id === 'derivative'}" title="${u.hint} 花费 ${u.cost} 能量，冷却 ${u.cooldown} 秒" aria-label="${u.name}，花费${u.cost}能量，${u.hint}"><span class="card-shortcut">${'123456790B'[UNITS.indexOf(u)]}</span><img src="${portrait(u.id)}" alt=""><span class="seed-name">${u.name}</span><span class="seed-cost">✦ ${u.cost}</span><span class="cooldown-mask" hidden></span></button>`,
      )
      .join(
        '',
      )}<button class="shovel-card" data-action="shovel" aria-pressed="false"><span>↶</span><b>回收</b><small>返还 50%</small></button><div class="tray-note"><span>CLICK TO PLANT</span><p id="selected-note">求导塔 · 两格起步，可联动</p><small>Esc 取消选择 · 空格暂停</small></div></section><div class="battle-state-banner" id="state-banner"><span class="state-dot"></span><b>准备阶段</b><span>布置好防线再开始。此阶段塔与门无冷却，炸弹在战斗开始后使用。</span></div><div class="board-wrap"><div id="game-canvas"></div><div class="board-loading" id="board-loading">正在展开棋盘…</div></div><section class="battle-bottom"><div class="formula-preview"><span class="preview-label">演算提示</span><p id="formula-preview">${escape(level.tip)}</p></div><button class="text-button" data-action="deselect">查看函数 ↗</button></section><div class="battle-tip"><span>✦</span> ${escape(level.tip)}</div></main>`,
  );
  const running = createGarden(
    document.querySelector<HTMLElement>('#game-canvas')!,
    model,
    {
      hud: () => {
        if (battle === model) {
          updateHud();
          document.querySelector('#board-loading')?.remove();
        }
      },
      notice: (message) => {
        if (battle === model) notify(message);
      },
      preview: (message) => {
        if (battle === model) setPreview(message);
      },
      inspect: (enemy) => {
        if (battle === model) inspectEnemy(enemy);
      },
      outcome: () => {
        if (battle === model) void showOutcome(model);
      },
    },
    sound,
  );
  game = running.game;
  scene = running.scene;
}
function setPreview(message: string): void {
  const el = document.querySelector('#formula-preview');
  if (el && el.textContent !== message) el.textContent = message;
}
function updateHud(): void {
  if (!battle) return;
  const model = battle;
  const assign = (id: string, text: string): void => {
    const element = document.getElementById(id);
    if (element && element.textContent !== text) element.textContent = text;
  };
  assign('energy', String(Math.floor(model.energy)));
  assign('lives', '♥ '.repeat(model.lives) + '♡ '.repeat(3 - model.lives));
  assign('timer', minute(model.time));
  assign('wave', model.phase === 'preparing' ? '准备阶段' : `${model.wave} / ${model.level.waves}`);
  assign(
    'wave-hint',
    model.intermission > 0
      ? `下一波 ${Math.ceil(model.intermission)} 秒后到来`
      : model.phase === 'preparing'
        ? '第一波：A / C / E 行'
        : `本波剩余 ${model.remaining} 个函数`,
  );
  const button = document.querySelector<HTMLButtonElement>('#pause-button');
  if (button) {
    button.textContent =
      model.phase === 'preparing'
        ? '准备就绪，开始 →'
        : model.phase === 'paused'
          ? '继续演算 →'
          : 'Ⅱ 暂停';
    button.disabled = model.phase === 'won' || model.phase === 'lost';
  }
  const banner = document.querySelector<HTMLElement>('#state-banner');
  if (banner) {
    banner.hidden = model.phase !== 'preparing' && model.phase !== 'paused';
    if (model.phase === 'paused')
      banner.innerHTML =
        '<span class="state-dot"></span><b>已暂停</b><span>时间已冻结，可以使用已有能量布阵。冷却与资源增长也会暂停。</span>';
    else if (model.phase === 'preparing')
      banner.innerHTML =
        '<span class="state-dot"></span><b>准备阶段</b><span>布置好防线再开始。此阶段塔与门无冷却，炸弹在战斗开始后使用。</span>';
  }
  if (scene && scene.selection !== selected) selected = scene.selection;
  for (const card of document.querySelectorAll<HTMLButtonElement>('.seed-card')) {
    const id = card.dataset.unit as UnitId,
      definition = unitById(id),
      cooldown = model.cooldowns[id] ?? 0;
    card.classList.toggle('selected', selected === id);
    card.setAttribute('aria-pressed', String(selected === id));
    card.classList.toggle('unaffordable', model.energy < definition.cost);
    const mask = card.querySelector<HTMLElement>('.cooldown-mask')!;
    mask.hidden = cooldown <= 0;
    mask.textContent = cooldown > 0 ? `${cooldown.toFixed(1)}s` : '';
    card.disabled =
      model.phase === 'won' ||
      model.phase === 'lost' ||
      (model.phase === 'preparing' && isBomb(id));
  }
  const shovel = document.querySelector('.shovel-card');
  shovel?.classList.toggle('selected', selected === 'shovel');
  shovel?.setAttribute('aria-pressed', String(selected === 'shovel'));
}
function selectUnit(selection: Selection): void {
  if (!battle) return;
  selected = selection;
  scene?.setSelection(selection);
  const note = document.querySelector('#selected-note');
  if (note)
    note.textContent =
      selection === 'shovel'
        ? '回收单位，返还一半能量'
        : selection
          ? `${unitById(selection).name} · ${selection === 'derivative' ? '射程可联动' : isBomb(selection) ? unitById(selection).example : '中点触发'}`
          : '点击敌人查看完整公式';
  if (selection && selection !== 'shovel')
    setPreview(unitById(selection).hint + ' ' + unitById(selection).example);
  updateHud();
}
function togglePause(): void {
  if (!battle) return;
  if (battle.phase === 'preparing') battle.start();
  else if (battle.phase === 'paused') battle.resume();
  else battle.pause();
  updateHud();
}
function inspectEnemy(enemy: Enemy): void {
  if (!battle || !scene) return;
  battle.pause();
  updateHud();
  const formula = format(enemy.expression);
  modal(
    `<button class="dialog-close" data-action="close" aria-label="关闭">×</button><span class="eyebrow">FUNCTION INSPECTOR</span><h2>看看它的结构</h2><div class="inspected-formula">${escape(formula)}</div><p class="muted">当前区间：0 &lt; x &lt; 1</p><div class="inspection-line">求导预览<br><strong>${escape(scene.resultFor(enemy))}</strong></div><button class="button primary wide" data-action="close">继续布阵</button>`,
    'small-dialog',
  );
}

async function showOutcome(model: Battle): Promise<void> {
  const won = model.phase === 'won';
  modal(
    `<div class="result-emblem">${won ? '✦' : '∅'}</div><span class="eyebrow">${won ? 'A BEAUTIFUL SOLUTION' : 'ANOTHER WAY EXISTS'}</span><h2>${won ? '所有变量，归于常数。' : '换一条解法，再来一次。'}</h2><p class="muted">${won ? `${model.level.title} · 演算完成` : '留意敌人的结构，并在炮台前方安排变换门。'}</p>${won ? stars(model.stars) : ''}<div class="result-stats"><span><small>消灭函数</small><b>${model.kills}</b></span><span><small>演算用时</small><b>${minute(model.time)}</b></span><span><small>剩余生命</small><b>${model.lives} / 3</b></span></div><p id="save-status" class="save-status" role="status">${won ? '正在保存闯关进度…' : '重新挑战会遇到同一批敌人，可以改进你的布阵。'}</p><div class="dialog-actions"><button class="button secondary" data-action="result-home">返回花园</button><button class="button primary" data-action="${won && model.level.id < LEVELS.length ? 'next-level' : 'retry-level'}" ${won ? 'disabled' : ''} id="result-primary">${won && model.level.id < LEVELS.length ? '前往下一章 →' : '再挑战一次 →'}</button></div><button class="text-button" id="save-retry" data-action="retry-save" hidden>重新同步成绩</button>`,
    'result-dialog',
  );
  if (won) await saveResult(model);
}
async function saveResult(model: Battle): Promise<void> {
  if (battle !== model || !session.user || saving === model) return;
  const owner = session,
    pending = readPending(owner),
    previous = pending.find((entry) => entry.level === model.level.id);
  saving = model;
  const homeButton = document.querySelector<HTMLButtonElement>('[data-action="result-home"]');
  if (homeButton) homeButton.disabled = true;
  const payload: PendingCompletion = {
    userId: session.user.id,
    progressRevision: session.user.progressRevision,
    submissionId: crypto.getRandomValues(new Uint32Array(4)).join('-'),
    level: model.level.id,
    stars: Math.max(previous?.stars ?? 0, model.stars),
    seconds: Math.min(previous?.seconds ?? Infinity, Math.max(1, Number(model.time.toFixed(2)))),
  };
  writePending(owner, [...pending.filter((entry) => entry.level !== payload.level), payload]);
  const status = document.querySelector('#save-status');
  const isCurrent = (): boolean =>
    session === owner && battle === model && document.querySelector('#save-status') === status;
  if (status) status.textContent = '正在保存闯关进度…';
  try {
    const applied = await submitProgress(owner, payload);
    if (applied && isCurrent()) {
      if (status) status.textContent = '✓ 进度已保存，可以安心离开。';
      const button = document.querySelector<HTMLButtonElement>('#result-primary');
      if (button) button.disabled = false;
      const retry = document.querySelector<HTMLElement>('#save-retry');
      if (retry) retry.hidden = true;
    }
  } catch (error) {
    if (!isCurrent()) return;
    const discarded = error instanceof ApiError && (error.status === 400 || error.status === 409);
    if (status)
      status.textContent =
        errorMessage(error) + (discarded ? '' : ' 成绩已暂存，下次登录时会重试。');
    const retry = document.querySelector<HTMLElement>('#save-retry');
    if (retry) retry.hidden = discarded;
  } finally {
    if (saving === model) saving = null;
    if (isCurrent() && homeButton) homeButton.disabled = false;
  }
}

function showLibrary(tab = libraryTab): void {
  if (!artworkReady) return;
  libraryTab = tab;
  if (battle) {
    battle.pause();
    updateHud();
  }
  const contents =
    tab === 'units'
      ? `<div class="library-grid">${UNITS.map((u) => `<article class="library-item"><img src="${portrait(u.id)}" alt="${u.name}"><div><span class="library-tag">${u.id === 'derivative' ? '持续攻击' : isBomb(u.id) ? '救急道具' : '一次性门'} · 第 ${u.level} 章</span><h3>${u.name}<small>✦ ${u.cost}</small></h3><p>${u.hint}</p><code>${escape(u.example)}</code><small>冷却 ${u.cooldown} 秒</small></div></article>`).join('')}</div>`
      : tab === 'enemies'
        ? `<div class="library-grid">${ENEMIES.map((e) => `<article class="library-item"><img src="${enemyPortrait(e.kind)}" alt="${e.name}"><div><span class="library-tag">函数来客</span><h3>${e.name}</h3><code>${escape(e.formula)}</code><p>${escape(e.route)}</p></div></article>`).join('')}</div>`
        : `<div class="rules-grid"><article><span>01</span><h3>先布阵，再开始</h3><p>准备阶段可以连续放置。敌人从右向左推进，越过左端就会扣除基地生命。</p></article><article><span>02</span><h3>把顺序排对</h3><p>求导塔基础射程为前方两格，覆盖前方塔时继承它的最远射程，可连续联动。门在敌人经过格子中点时先触发，然后结算子弹。</p></article><article><span>03</span><h3>随时停下来想一想</h3><p>按空格暂停，可继续花费已有能量布阵。暂停不产能量，也不推进冷却。切换标签页会自动暂停。</p></article><article><span>04</span><h3>每种变化，都讲道理</h3><p>本版所有关卡规定 0 &lt; x &lt; 1。合法但复杂的运算会照常执行；无定义的变换无效，门仍消耗。</p></article><article><span>05</span><h3>看懂你的对手</h3><p>点击“查看函数”后选择敌人，可暂停查看完整式子。敌人占格时也可补种，已过中点的不补触发；补塔也不会挡回已经过中点的敌人。</p></article><article><span>06</span><h3>留一点调整的余地</h3><p>炸弹只能种在没有己方单位的格子；敌人经过该格中点才引爆，已过中点的不触发。爆炸清除单格、3×3 或整行敌人，不伤己方。1–7 选运算，9 / 0 / B 选炸弹，S 回收塔或门（返还 50%），Esc 取消。</p></article></div>`;
  modal(
    `<button class="dialog-close" data-action="close" aria-label="关闭手册">×</button><span class="eyebrow">THE FIELD GUIDE</span><h2>一本会帮上忙的函数手册</h2><p class="muted">认清结构，再选择你的运算路线。</p><div class="manual-tabs" role="tablist"><button role="tab" aria-selected="${tab === 'units'}" data-action="library-tab" data-tab="units">运算与道具 <small>${UNITS.length}</small></button><button role="tab" aria-selected="${tab === 'enemies'}" data-action="library-tab" data-tab="enemies">函数来客 <small>09</small></button><button role="tab" aria-selected="${tab === 'rules'}" data-action="library-tab" data-tab="rules">作战规则</button></div>${contents}`,
    'library-dialog',
  );
}
function confirmLeave(action: 'home' | 'logout' | 'restart'): void {
  if (!battle) {
    if (action === 'logout') void logout();
    else showLobby();
    return;
  }
  battle.pause();
  updateHud();
  modal(
    `<span class="eyebrow">TAKE A MOMENT</span><h2>${action === 'restart' ? '重新安排这道题？' : '暂时离开花园？'}</h2><p class="muted">当前对局会结束，已通关的进度会保留。${action === 'restart' ? '重新开始时会保留这次的敌人安排。' : ''}</p><div class="dialog-actions"><button class="button secondary" data-action="close">继续布阵</button><button class="button primary" data-action="confirm-${action}">${action === 'restart' ? '重新开始' : '确认离开'}</button></div>`,
    'small-dialog',
  );
}
async function logout(): Promise<void> {
  try {
    await request('/api/logout', {});
    session = { user: null, progress: [] };
    authMode = 'login';
    closeModal();
    showAuth();
  } catch (error) {
    notify(errorMessage(error));
  }
}

app.addEventListener(
  'pointerdown',
  () => {
    void sound.unlock();
  },
  { passive: true },
);
app.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  const action = target.dataset.action;
  event.preventDefault();
  switch (action) {
    case 'auth-login':
    case 'auth-register':
      if (!authBusy) {
        authMode = action === 'auth-login' ? 'login' : 'register';
        showAuth();
      }
      break;
    case 'password': {
      const input = document.querySelector<HTMLInputElement>('input[name=password]')!;
      input.type = input.type === 'password' ? 'text' : 'password';
      target.textContent = input.type === 'password' ? '显示' : '隐藏';
      break;
    }
    case 'sound':
      sound.toggle();
      target.textContent = sound.enabled ? '♪' : '♩';
      target.setAttribute('aria-label', sound.enabled ? '关闭音效' : '开启音效');
      break;
    case 'home':
      if (session.user) confirmLeave('home');
      break;
    case 'logout':
      confirmLeave('logout');
      break;
    case 'restart':
      confirmLeave('restart');
      break;
    case 'confirm-home':
    case 'result-home':
      closeModal();
      showLobby();
      break;
    case 'confirm-logout':
      void logout();
      break;
    case 'confirm-restart':
    case 'retry-level':
      if (battle) startBattle(battle.level.id, battle.seed);
      break;
    case 'next-level':
      if (battle) startBattle(battle.level.id + 1);
      break;
    case 'level':
      startBattle(Number(target.dataset.level));
      break;
    case 'select-unit':
      selectUnit(target.dataset.unit as UnitId);
      break;
    case 'shovel':
      selectUnit(selected === 'shovel' ? null : 'shovel');
      break;
    case 'deselect':
      selectUnit(null);
      notify('点击一个敌人，查看完整公式。');
      break;
    case 'pause':
      togglePause();
      break;
    case 'close':
      closeModal();
      break;
    case 'library':
      showLibrary();
      break;
    case 'library-tab':
      showLibrary(target.dataset.tab);
      break;
    case 'retry-save':
      if (battle) void saveResult(battle);
      break;
    case 'retry-connect':
      void boot();
      break;
  }
});
document.addEventListener('keydown', (event) => {
  if (
    !battle ||
    document.querySelector<HTMLDialogElement>('#modal')?.open ||
    (event.target as Element).matches('input,textarea,select')
  )
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    togglePause();
  } else if (event.key === 'Escape') selectUnit(null);
  else if (event.key.toLowerCase() === 's') selectUnit('shovel');
  else if (/^[1-79b0]$/i.test(event.key)) {
    const unit = UNITS['123456790b'.indexOf(event.key.toLowerCase())]!;
    if (unit.level <= battle.level.id) selectUnit(unit.id);
  } else if (event.key === '?') showLibrary('rules');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && battle) {
    battle.pause();
    updateHud();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (battle && (battle.phase === 'running' || battle.phase === 'paused')) {
    event.preventDefault();
    event.returnValue = '';
  }
});
async function boot(): Promise<void> {
  app.innerHTML =
    '<div class="boot-screen"><span class="brand-mark">D<i></i></span><p>正在布置手绘庭院…</p></div>';
  try {
    await loadArtwork();
    artworkReady = true;
    session = await request<SessionInfo>('/api/session');
    if (session.user) {
      await retryPending();
      showLobby();
    } else showAuth();
  } catch (error) {
    shell(
      `<main class="connection-error"><span class="eyebrow">THE GARDEN IS RESTING</span><h1>花园还没有醒来。</h1><p>${escape(errorMessage(error))}</p><button class="button primary" data-action="retry-connect">重新连接 →</button></main>`,
    );
  }
}
void boot();
