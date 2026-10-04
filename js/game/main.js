// ARMY ANTS 本体：起動、画面の流れ（タイトル → ステージ → 攻城／ボス → 次のステージ … → クリア）
import { Application, Container, Sprite, Texture, Graphics } from '../../vendor/pixi.min.mjs';
import { PixelView } from '../core/pixelview.js';
import { loadSprites } from '../core/sprites.js';
import { Ground } from '../core/ground.js';
import { Swarm } from '../core/swarm.js';
import { FX } from '../core/fx.js';
import { DragInput } from '../core/input.js';
import { PixelText } from '../core/pixelfont.js';
import { CONFIG } from './config.js';
import { t, setLang, getLang, fmt } from './i18n.js';
import { loadSave, getSave, save, deleteSave, recordRun } from './save.js';
import { initAudio, setSoundEnabled, sfx } from './audio.js';
import { buildRun, AREAS } from './stages.js';
import { meta, runSetup, refreshMods, finishRun, todayKey, dailyRecord, recordDaily, upgradeCost, buyUpgrade,
         lockedCards, buyCard, UPGRADE_KEYS } from './meta.js';
import { drawCards, cardText } from './cards.js';
import { rngFor } from '../core/rng.js';
import { Field } from './runner.js';
import { Siege } from './siege.js';
import { Boss } from './boss.js';
import { Hud, showScreen, hideScreens, fillResult } from './hud.js';
import { variantName, swarmLook } from './mutation.js';

const HALF = CONFIG.track.width / 2;
const $ = (id) => document.getElementById(id);

const G = {
  phase: 'loading',     // title / runner / boss / siege / between / result
  paused: false,
  timeScale: 1,
  slowT: 0,
  run: null,
  field: null,
  siege: null,
  nums: [],
};
window.ARMY = G;   // 確認用

function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

// -----------------------------------------------------------------------------
// 共通の道具
// -----------------------------------------------------------------------------
G.worldToCss = (x, y) => {
  const v = G.view;
  return { x: (x - v.camX + v.W / 2) / v.W * v.cssW, y: (y - v.camY + v.H / 2) / v.H * v.cssH };
};
G.toWorld = (cx, cy) => {
  const v = G.view;
  const r = G.app.canvas.getBoundingClientRect();
  return { x: (cx - r.left) / r.width * v.W - v.W / 2 + v.camX, y: (cy - r.top) / r.height * v.H - v.H / 2 + v.camY };
};
G.popup = (x, y, text, kind) => {
  const p = G.worldToCss(x, y);
  G.hud.popup(p.x, p.y, text, kind);
};
G.popupNum = (x, y, text, tint) => {
  const n = new PixelText(text, 2);
  n.tint = tint;
  n.position.set(Math.round(x), Math.round(y));
  G.layers.top.addChild(n);
  G.nums.push({ n, t: 0.9, y });
};
G.slowmo = () => { G.slowT = CONFIG.gate.slowmoTime; };
// ゲームの中の時間で待つ（一時停止中は進まない）
G.timers = [];
G.later = (sec, fn) => { G.timers.push({ t: sec, fn }); };
G.flash = (color, s) => G.hud.flash(color, s);
G.banner = (text, kind, sub) => G.hud.banner(text, kind, sub);

// -----------------------------------------------------------------------------
// 起動
// -----------------------------------------------------------------------------
async function boot() {
  const sv = loadSave();
  setLang(sv.settings.lang || getLang());
  setSoundEnabled(sv.settings.sound);
  const app = new Application();
  await app.init({ background: '#000000', antialias: false, resolution: 1, autoDensity: false, preference: 'webgl' });
  $('play').appendChild(app.canvas);
  G.app = app;
  const sprites = await loadSprites('assets/sprites/', (p) => { $('load-bar').style.width = Math.round(p * 100) + '%'; });
  G.sprites = sprites;
  const view = new PixelView(app);
  G.view = view;

  // 重ねる順番（下から）：地面 → 地面の上の物 → 群れ・敵（奥から順） → 粒 → 一番上（ゲート・数字）
  const L = {
    under: new Container(), mid: new Container(), top: new Container(), glow: new Container(), groundGlow: new Container(),
  };
  G.layers = L;
  G.ground = new Ground(sprites, 'garden', L.groundGlow);
  G.swarm = new Swarm(sprites);
  G.fx = new FX();
  L.mid.addChild(G.swarm.layer);
  G.light = new Sprite(radialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
  G.light.anchor.set(0.5);
  G.light.blendMode = 'add';
  G.edges = new Graphics();
  view.world.addChild(G.ground.layer, G.light, L.under, G.fx.under, L.mid, G.fx.over, G.edges, L.top);
  view.glow.addChild(L.groundGlow, G.swarm.glowLayer, L.glow, G.fx.glow);
  const vignette = new Sprite(radialTexture(256, [[0, 'rgba(0,0,0,0)'], [0.6, 'rgba(0,0,0,0.03)'], [1, 'rgba(0,0,0,0.5)']]));
  view.overlay.addChild(vignette);
  view.onResize = (W, H) => {
    vignette.width = W * 1.25;
    vignette.height = H * 1.15;
    vignette.position.set(-W * 0.125, -H * 0.075);
  };
  view.resize();
  window.addEventListener('resize', () => view.resize());

  G.hud = new Hud(G);
  G.input = new DragInput(app.canvas, {
    getX: () => G.swarm.targetX,
    setX: (x) => { G.swarm.targetX = Math.max(-HALF + 8, Math.min(HALF - 8, x)); },
    dotsPerCss: () => view.dotsPerCss,
  });
  G.swarm.onRemove = (a, opts) => {
    if (opts.removedBurst === false) return;
    G.fx.burst(G.fx.over, a.x, a.y, 3, { color: [0x3a111b, 0x5e1b27, 0x0f090b], speed: [20, 70], life: [0.2, 0.5], drag: 5 });
  };

  setupUi();
  $('loading').remove();
  toTitle();
  app.ticker.add((tk) => frame(Math.min(tk.deltaMS / 1000, 0.05)));
  document.addEventListener('visibilitychange', () => { if (document.hidden && isPlaying()) pause(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isPlaying()) pause(); });
}

function isPlaying() {
  return ['runner', 'boss', 'siege', 'between'].includes(G.phase) && !G.paused;
}

// -----------------------------------------------------------------------------
// 毎フレーム
// -----------------------------------------------------------------------------
function frame(realDt) {
  const view = G.view;
  if (G.paused) { view.render(0); return; }
  let dt = realDt;
  if (G.slowT > 0) { G.slowT -= realDt; dt *= CONFIG.gate.slowmoScale; }
  const sw = G.swarm;
  G.input.update(dt);
  if (G.phase === 'title') {
    sw.targetX = Math.sin(sw.time * 0.5) * 70;
  }
  if (G.phase !== 'siege') sw.update(dt);
  G.field?.update(dt);
  G.siege?.update(dt);
  G.fx.update(dt);
  if (G.timers.length) {
    const due = [];
    G.timers = G.timers.filter((tm) => { tm.t -= realDt; if (tm.t <= 0) { due.push(tm.fn); return false; } return true; });
    for (const fn of due) fn();
  }
  // 浮かぶ数字
  G.nums = G.nums.filter((p) => {
    p.t -= realDt;
    p.y -= 22 * realDt;
    p.n.position.y = Math.round(p.y);
    p.n.alpha = Math.min(1, p.t * 2);
    if (p.t <= 0) { p.n.destroy(); return false; }
    return true;
  });
  // カメラ
  if (G.phase !== 'siege') {
    const span = HALF + 12 - view.W / 2;
    view.camX = span > 0 ? Math.max(-span, Math.min(span, sw.x * 0.8)) : 0;
    view.camY = sw.y - (CONFIG.runner.swarmScreenY - 0.5) * view.H;
  }
  G.ground.update(view.camX, view.camY, view.W, view.H);
  // 群れの下の地面を照らす光
  G.light.visible = G.phase !== 'siege' && sw.count > 0;
  G.light.tint = sw.glowColor;
  G.light.alpha = 0.12 + Math.min(0.08, sw.ants.length / 4000);
  G.light.position.set(Math.round(sw.x), Math.round(sw.y));
  G.light.width = sw.rx * 2.6 + 50;
  G.light.height = sw.ry * 2.6 + 50;
  sw.label.visible = G.phase !== 'siege' && G.phase !== 'title' && sw.count > 0;
  // 道のはしを暗く
  const e = G.edges;
  e.clear();
  const top = view.camY - view.H / 2 - 4, h = view.H + 8;
  e.rect(-HALF - 400, top, 400, h).fill({ color: 0x000000, alpha: 0.32 });
  e.rect(HALF, top, 400, h).fill({ color: 0x000000, alpha: 0.32 });
  e.rect(-HALF - 1, top, 1, h).fill({ color: 0x3a111b, alpha: 0.6 });
  e.rect(HALF, top, 1, h).fill({ color: 0x3a111b, alpha: 0.6 });
  view.render(dt);
}

// -----------------------------------------------------------------------------
// 画面の流れ
// -----------------------------------------------------------------------------
function clearPlay() {
  G.timers = [];
  G.field?.destroy();
  G.field = null;
  G.siege?.destroy();
  G.siege = null;
  G.fx.clear();
  G.hud.bossBar(null);
  for (const p of G.nums) p.n.destroy();
  G.nums = [];
  G.slowT = 0;
}

function toTitle() {
  clearPlay();
  G.phase = 'title';
  G.paused = false;
  G.run = null;
  G.hud.show(false);
  G.ground.setArea('garden');
  const sw = G.swarm;
  sw.clear();
  sw.teleport(0, 0);
  sw.speed = 30;
  sw.bounds = null;
  sw.setVariant('base', { glowColor: 0xff3a2a, glowScale: 0.5 });
  sw.setCount(140);
  refreshTitle();
  showScreen('title');
}

function refreshTitle() {
  const r = getSave().records;
  const m = meta();
  $('title-best').textContent = r.bestStage >= 0 ? t('best', { where: stageLabel(r.bestStage), n: fmt(r.bestCount) }) : '';
  $('title-honey').textContent = t('honey', { n: fmt(m.honey) });
  $('title-daily').textContent = t('daily_rec', { date: todayKey(), rec: dailyText() });
  $('inv-row').classList.toggle('hidden', m.invasionMax <= 0);
  m.invasion = Math.min(m.invasion, m.invasionMax);
  $('inv-val').textContent = t('invasion', { n: m.invasion });
}

function stageLabel(i) {
  const a = Math.floor(i / CONFIG.run.stagesPerArea), s = i % CONFIG.run.stagesPerArea;
  return `${a + 1}-${s + 1}`;
}

/** 「エリア2 森 2-3」のような到達場所の名前 */
function whereLabel(i) {
  const a = Math.floor(i / CONFIG.run.stagesPerArea);
  return `${t('area', { n: a + 1 })} ${t('area_' + AREAS[a])} ${stageLabel(i)}`;
}

function dailyText() {
  const d = dailyRecord();
  return d.bestStage < 0 ? t('daily_none') : t('daily_fmt', { where: stageLabel(d.bestStage), n: fmt(d.bestCount) });
}

function startRun(mode = 'normal') {
  initAudio();
  hideScreens();
  const setup = runSetup(mode);
  G.run = {
    ...setup, stages: buildRun(setup.seed), stageIndex: 0,
    count: setup.startCount, maxCount: setup.startCount, weapon: null, armor: 0,
    cards: [], honey: 0, shortBy: 0,
  };
  refreshMods(G.run);
  G.lastMode = mode;
  G.hud.show(true);
  G.hud.refresh();
  startStage(0);
}

// 確認用：好きなステージ・匹数・変異から始める（コンソールから ARMY.debugStart(10, 500, 'bullet', 2, 1)）
G.debugStart = (i, count = 100, weapon = null, wlv = 1, armor = 0, cards = []) => {
  startRun();
  G.run.count = count;
  G.run.maxCount = count;
  G.run.weapon = weapon ? { type: weapon, lv: wlv } : null;
  G.run.armor = armor;
  G.run.cards = cards;
  refreshMods(G.run);
  startStage(i);
};

function startStage(i) {
  clearPlay();
  hideScreens();
  const run = G.run;
  run.stageIndex = i;
  run.shortBy = 0;
  const stage = run.stages[i];
  G.ground.setArea(stage.areaName);
  const sw = G.swarm;
  sw.clear();
  sw.teleport(0, 0);
  sw.setVariant(variantName(run), swarmLook(run));
  sw.setCount(run.count);
  G.view.camX = 0;
  G.view.camY = sw.y - (CONFIG.runner.swarmScreenY - 0.5) * G.view.H;
  G.field = new Field(G, stage, {
    onCourseEnd: () => courseEnd(stage),
    onWipe: () => gameOver('wipe'),
  });
  G.phase = 'runner';
  G.hud.setStage(stage, run.mode === 'daily');
  G.hud.refresh();
  const title = stage.local === 0 ? t('area', { n: stage.area + 1 }) + '  ' + t('area_' + stage.areaName)
                                   : t('stage', { a: stage.area + 1, s: stage.local + 1 });
  G.banner(title, stage.local === 0 ? 'area' : '', t('phase_run'));
}

function courseEnd(stage) {
  if (G.phase !== 'runner') return;
  if (stage.boss) {
    G.phase = 'boss';
    spawnBoss(stage.bossKind);
  } else {
    // コースを抜けた → 少し走ってから攻城へ（何が起きたか分かるように）
    G.phase = 'between';
    G.banner(t('course_clear'), 'good', t('next_siege', { n: fmt(G.run.count) }));
    sfx.clear();
    G.later(1.1, () => { if (G.phase === 'between' && G.field) startSiege(stage); });
  }
}

function spawnBoss(kind) {
  const f = G.field;
  f.boss?.destroy();
  f.boss = new Boss(f, kind, {
    onDefeated: () => {
      if (kind === 'hornet') {
        G.banner(t('queen_appears'), 'boss');
        G.later(0.9, () => { if (G.field === f && G.phase === 'boss') spawnBoss('queen'); });
      } else if (kind === 'queen') {
        allClear();
      } else {
        G.banner(t('boss_down'), 'good', t('carry', { n: fmt(G.run.count) }));
        sfx.clear();
        G.phase = 'between';
        G.later(1.6, () => stageCleared());
      }
    },
  });
  if (kind !== 'queen') G.banner(t('boss_' + kind), 'boss', t('phase_boss'));
}

function startSiege(stage) {
  G.flash(0x000000, 0.8);
  G.field.destroy();
  G.field = null;
  G.fx.clear();
  G.swarm.clear();
  G.phase = 'siege';
  G.siege = new Siege(G, stage, {
    onClear: (survivors) => {
      G.run.count = Math.round(survivors);
      G.run.maxCount = Math.max(G.run.maxCount, G.run.count);
      G.banner(t('stage_clear'), 'good', t('carry', { n: fmt(G.run.count) }));
      sfx.clear();
      G.phase = 'between';
      G.later(1.3, () => stageCleared());
    },
    onFail: (hp) => gameOver('siege', hp),
  });
}

/** ステージを落とした → 法則カードを選んで次へ */
function stageCleared() {
  if (!G.run) return;
  recordRun(G.run.stageIndex, G.run.maxCount);
  if (G.run.count <= 0) { gameOver('wipe'); return; }
  if (G.run.stageIndex + 1 >= G.run.stages.length) { allClear(); return; }
  showCards();
}

function showCards() {
  const run = G.run;
  clearPlay();
  G.phase = 'cards';
  // 今日のコースは日付で決まるので、全員が同じ候補になる
  const rng = rngFor(run.seed + ':cards:' + run.stageIndex);
  const ids = drawCards(rng, run.pool, run.cards, run.choices);
  const list = $('card-list');
  list.innerHTML = '';
  for (const id of ids) {
    const c = cardText(id, getLang());
    const n = run.cards.filter((x) => x === id).length;
    const b = document.createElement('button');
    b.className = 'card cat-' + c.cat;
    b.innerHTML = `<span class="c-cat">${t('cat_' + c.cat)}</span><b>${c.name}${n ? ` <i>×${n + 1}</i>` : ''}</b><span class="c-desc">${c.desc}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.mutate();
      run.cards.push(id);
      refreshMods(run);
      startStage(run.stageIndex + 1);
    });
    list.appendChild(b);
  }
  $('card-sub').textContent = t('next_stage_label', { where: whereLabel(run.stageIndex + 1), n: fmt(run.count) });
  $('card-owned').textContent = ownedText(run);
  showScreen('cards');
}

function ownedText(run) {
  if (!run.cards.length) return t('owned_cards', { list: t('none') });
  const counts = {};
  for (const id of run.cards) counts[id] = (counts[id] || 0) + 1;
  const list = Object.entries(counts).map(([id, n]) => cardText(id, getLang()).name + (n > 1 ? '×' + n : '')).join('、');
  return t('owned_cards', { list });
}

function endRun(cleared) {
  const run = G.run;
  const res = finishRun(run, cleared);
  if (run.mode === 'daily') recordDaily(cleared ? run.stages.length - 1 : run.stageIndex, run.maxCount);
  return res;
}

function gameOver(reason, hp = 0) {
  if (G.phase === 'result') return;
  G.phase = 'result';
  sfx.gameOver();
  const run = G.run;
  recordRun(run.stageIndex, run.maxCount);
  const res = endRun(false);
  const r = getSave().records;
  G.later(0.9, () => {
    fillResult({
      title: reason === 'siege' ? t('siege_failed') : t('game_over'),
      reached: whereLabel(run.stageIndex),
      maxCount: run.maxCount,
      shortBy: reason === 'siege' ? hp : Math.max(1, run.shortBy || 1),
      best: t('best', { where: stageLabel(r.bestStage), n: fmt(r.bestCount) }),
      honey: t('honey_gained', { n: fmt(res.honey), total: fmt(meta().honey) }),
      daily: t('daily_rec', { date: todayKey(), rec: dailyText() }),
      good: false,
    });
    showScreen('result');
  });
}

function allClear() {
  if (G.phase === 'result') return;
  G.phase = 'result';
  sfx.clear();
  const run = G.run;
  recordRun(run.stages.length - 1, run.maxCount);
  const res = endRun(true);
  const r = getSave().records;
  G.banner(t('all_clear'), 'good');
  G.later(2.6, () => {
    fillResult({
      title: t('all_clear'), sub: t('all_clear_sub'), reached: t('boss_queen'),
      maxCount: run.maxCount, best: t('best', { where: stageLabel(r.bestStage), n: fmt(r.bestCount) }), good: true,
      honey: t('honey_gained', { n: fmt(res.honey), total: fmt(meta().honey) }),
      unlock: res.unlocked ? t('invasion_unlocked', { n: res.unlocked }) : '',
      daily: t('daily_rec', { date: todayKey(), rec: dailyText() }),
    });
    G.cleared = true;
    showScreen('result');
  });
}

/** Xでシェア：最大匹数・到達エリア・今日のコースの記録・ゲームのURL */
function share() {
  const run = G.run;
  if (!run) return;
  const where = G.cleared ? t('share_clear') : whereLabel(run.stageIndex);
  const text = t('share_text', { where, n: fmt(run.maxCount), daily: dailyText(), date: todayKey() });
  const url = 'https://tanukibox.github.io/army-ants/';
  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url), '_blank', 'noopener');
}

function pause() {
  G.paused = true;
  $('pause-cards').textContent = G.run ? ownedText(G.run) : '';
  showScreen('pause');
}

// -----------------------------------------------------------------------------
// 女王の部屋（蜜で永続強化・法則カードの解放）
// -----------------------------------------------------------------------------
function openQueen() {
  const m = meta();
  $('queen-honey').textContent = t('honey', { n: fmt(m.honey) });
  const list = $('queen-list');
  list.innerHTML = '';
  const row = (title, sub, cost, onBuy) => {
    const d = document.createElement('div');
    d.className = 'q-row';
    const can = cost !== null && m.honey >= cost;
    d.innerHTML = `<div class="q-text"><b>${title}</b><span>${sub}</span></div>`;
    const b = document.createElement('button');
    b.className = 'btn small' + (can ? ' main' : '');
    b.textContent = cost === null ? t('maxed') : t('buy', { cost: fmt(cost) });
    b.disabled = !can;
    b.addEventListener('click', (e) => { e.stopPropagation(); if (onBuy()) { sfx.mutate(); openQueen(); } });
    d.appendChild(b);
    list.appendChild(d);
  };
  const head = (text) => { const h = document.createElement('div'); h.className = 'q-head'; h.textContent = text; list.appendChild(h); };
  head(t('queen_upgrades'));
  for (const key of UPGRADE_KEYS) {
    const lv = m.upgrades[key], max = CONFIG.upgrades[key].costs.length;
    row(t('up_' + key), t('lv_of', { n: lv, max }), upgradeCost(key), () => buyUpgrade(key));
  }
  head(t('unlock_cards'));
  const locked = lockedCards();
  if (!locked.length) { const p = document.createElement('div'); p.className = 'q-note'; p.textContent = t('all_unlocked'); list.appendChild(p); }
  for (const c of locked) {
    const tx = cardText(c.id, getLang());
    row(tx.name, tx.desc, c.cost, () => buyCard(c.id));
  }
  showScreen('queen');
}

// -----------------------------------------------------------------------------
// ボタン
// -----------------------------------------------------------------------------
function setupUi() {
  const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); sfx.ui(); fn(); });
  click('btn-sortie', () => startRun('normal'));
  click('btn-daily', () => startRun('daily'));
  click('btn-queen', () => openQueen());
  click('btn-queen-close', () => { refreshTitle(); showScreen('title'); });
  click('inv-dn', () => { const m = meta(); m.invasion = Math.max(0, m.invasion - 1); save(); refreshTitle(); });
  click('inv-up', () => { const m = meta(); m.invasion = Math.min(m.invasionMax, m.invasion + 1); save(); refreshTitle(); });
  click('btn-title-settings', () => openSettings('title'));
  click('btn-pause', () => { if (isPlaying()) pause(); });
  click('btn-resume', () => { G.paused = false; hideScreens(); });
  click('btn-pause-settings', () => openSettings('pause'));
  click('btn-retire', () => toTitle());
  click('btn-retry', () => { G.cleared = false; startRun(G.lastMode || 'normal'); });
  click('btn-to-title', () => { G.cleared = false; toTitle(); });
  click('btn-share', () => share());
  click('btn-settings-close', () => { if (settingsFrom === 'title') refreshTitle(); showScreen(settingsFrom); });
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      getSave().settings.lang = b.dataset.lang;
      save();
      setLang(b.dataset.lang);
      G.hud.refresh();
      refreshSettings();
    });
  }
  for (const b of document.querySelectorAll('[data-sound]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = b.dataset.sound === 'on';
      getSave().settings.sound = on;
      save();
      setSoundEnabled(on);
      initAudio();
      refreshSettings();
    });
  }
  click('btn-delete', () => {
    if (!window.confirm(t('delete_confirm'))) return;
    deleteSave();
    setSoundEnabled(true);
    $('delete-msg').textContent = t('deleted');
    refreshSettings();
  });
}

let settingsFrom = 'title';
function openSettings(from) {
  settingsFrom = from;
  $('delete-msg').textContent = '';
  refreshSettings();
  showScreen('settings');
}

function refreshSettings() {
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === getLang());
  const snd = getSave().settings.sound;
  for (const b of document.querySelectorAll('[data-sound]')) b.classList.toggle('on', (b.dataset.sound === 'on') === snd);
}

boot().catch((e) => {
  console.error(e);
  const l = $('loading');
  if (l) l.querySelector('.msg').textContent = t('load_failed', { msg: e.message });
});
