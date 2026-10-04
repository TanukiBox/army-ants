// ARMY ANTS フェーズ1：見た目の試作
// ボタンで「変異の種類」「Lv」「匹数」「拡大」を切り替えて見比べる。ゲームのルールはまだ無い。
import { Application, Sprite, Texture } from '../vendor/pixi.min.mjs';
import { PixelView } from '../js/core/pixelview.js';
import { loadSprites } from '../js/core/sprites.js';
import { Ground } from '../js/core/ground.js';
import { Swarm } from '../js/core/swarm.js';
import { FX } from '../js/core/fx.js';
import { DragInput } from '../js/core/input.js';

const TYPES = {
  base:     { label: '通常',     name: 'ふつうのアリ',            note: '黒〜深紅の甲殻。光るのは目だけ', glow: 'red',    hasLv: false, glowScale: 0.5 },
  mandible: { label: 'アギト',   name: 'アギトアリ（顎型）',       note: '顎で敵を弾き飛ばす。Lvで顎が長く鋭く', glow: 'ember', hasLv: true },
  fire:     { label: 'ヒアリ',   name: 'ヒアリ（毒弾型）',         note: '腹が赤く光り、緑の毒弾を撃つ',     glow: 'red',    hasLv: true },
  bullet:   { label: 'サシハリ', name: 'サシハリアリ（毒針型）',   note: '紫に光る大きな毒針。一撃が重い',   glow: 'purple', hasLv: true },
  bomb:     { label: '自爆',     name: '自爆アリ（爆発型）',       note: '腹がふくらみ黄色く脈打つ。突撃して爆発', glow: 'yellow', hasLv: true, pulse: 'beat' },
  armor:    { label: '甲殻',     name: '甲殻装甲（防具）',         note: '外骨格が厚くなる。Lv3で金属の光沢と光る線', glow: 'cyan', hasLv: true },
};
const COUNTS = [1, 50, 300, 10000];
const ZOOMS = [1, 2, 4];

const state = { type: 'base', lv: 1, count: 300, zoom: 1, auto: true };

function variantName() {
  if (state.type === 'base') return 'base';
  if (state.type === 'armor') return `armor${state.lv}`;
  return `${state.type}${state.lv}`;
}

function hex(s) { return parseInt(s.slice(1), 16); }

/** やわらかい丸い光（群れの下の地面を照らす光・画面のふちの暗さに使う） */
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

async function main() {
  const app = new Application();
  await app.init({ background: '#000000', antialias: false, resolution: 1, autoDensity: false, preference: 'webgl' });
  const play = document.getElementById('play');
  play.appendChild(app.canvas);

  const sprites = await loadSprites('../assets/sprites/');
  const glowHex = Object.fromEntries(Object.entries(sprites.glows).map(([k, v]) => [k, hex(v)]));

  const view = new PixelView(app);
  const ground = new Ground(sprites);
  const swarm = new Swarm(sprites);
  const fx = new FX();
  const light = new Sprite(radialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
  light.anchor.set(0.5);
  light.blendMode = 'add';
  const vignette = new Sprite(radialTexture(256, [[0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0.05)'], [1, 'rgba(0,0,0,0.78)']]));
  view.world.addChild(ground.layer, light, fx.under, swarm.layer, fx.over);
  view.glow.addChild(swarm.glowLayer, fx.glow);
  view.overlay.addChild(vignette);

  let trackHalf = 130;
  view.onResize = (W, H) => {
    vignette.width = W * 1.25;
    vignette.height = H * 1.15;
    vignette.position.set(-W * 0.125, -H * 0.075);
    trackHalf = Math.min(150, Math.floor(W / view.zoom / 2) - 10);
  };
  view.resize();
  window.addEventListener('resize', () => view.resize());

  const input = new DragInput(app.canvas, {
    getX: () => swarm.targetX,
    setX: (x) => { swarm.targetX = Math.max(-trackHalf, Math.min(trackHalf, x)); },
    dotsPerCss: () => view.dotsPerCss,
  });

  // --- ボタン -----------------------------------------------------------------
  const info = document.getElementById('info');
  function applyVariant(sweep) {
    const T = TYPES[state.type];
    swarm.setVariant(variantName(), { glowColor: glowHex[T.glow], pulse: T.pulse || 'steady', glowScale: T.glowScale ?? 1, sweep });
    info.innerHTML = `<b>${T.name}${T.hasLv ? ' Lv' + state.lv : ''}</b><span>${T.note}</span>`;
    fx.timers = {};
    refreshButtons();
  }
  function refreshButtons() {
    document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b.dataset.type === state.type));
    document.querySelectorAll('[data-lv]').forEach((b) => {
      b.classList.toggle('on', +b.dataset.lv === state.lv && TYPES[state.type].hasLv);
      b.disabled = !TYPES[state.type].hasLv;
    });
    document.querySelectorAll('[data-count]').forEach((b) => b.classList.toggle('on', +b.dataset.count === state.count));
    document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('on', +b.dataset.zoom === state.zoom));
    document.getElementById('auto').classList.toggle('on', state.auto);
  }
  function makeButtons(id, items, attr, onPick) {
    const box = document.getElementById(id);
    for (const [val, label] of items) {
      const b = document.createElement('button');
      b.dataset[attr] = val;
      b.textContent = label;
      b.addEventListener('click', () => onPick(val));
      box.appendChild(b);
    }
  }
  makeButtons('types', Object.entries(TYPES).map(([k, v]) => [k, v.label]), 'type', (v) => {
    if (state.type === v) return;
    state.type = v;
    applyVariant(true);
  });
  makeButtons('lvs', [[1, '1'], [2, '2'], [3, '3']], 'lv', (v) => {
    state.lv = +v;
    applyVariant(true);
  });
  makeButtons('counts', COUNTS.map((n) => [n, n >= 10000 ? '1万' : String(n)]), 'count', (v) => {
    state.count = +v;
    swarm.setCount(state.count);
    refreshButtons();
  });
  makeButtons('zooms', ZOOMS.map((z) => [z, '×' + z]), 'zoom', (v) => {
    state.zoom = +v;
    view.setZoom(state.zoom);
    refreshButtons();
  });
  document.getElementById('auto').addEventListener('click', () => { state.auto = !state.auto; refreshButtons(); });
  document.getElementById('fire').addEventListener('click', () => {
    fx.attack(state.type, state.lv, swarm, view);
  });

  swarm.setCount(state.count);
  applyVariant(false);
  window.ARMY_DEBUG = { app, view, swarm, fx, ground, state };   // 確認用
  document.getElementById('loading').remove();

  // --- 毎フレーム ---------------------------------------------------------------
  const fpsEl = document.getElementById('fps');
  let fpsT = 0, frames = 0, busy = 0;
  app.ticker.add((ticker) => {
    const t0 = performance.now();
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    input.update(dt);
    swarm.update(dt);
    if (state.auto) fx.auto(state.type, state.lv, swarm, dt, view);
    fx.update(dt);
    // カメラ：ふだんは道の真ん中。拡大したら群れを追う
    const zoomed = state.zoom > 1;
    view.camX = zoomed ? swarm.x : 0;
    view.camY = swarm.y - (zoomed ? 0 : view.H * 0.06);
    ground.update(view.camX, view.camY, view.W, view.H);
    const T = TYPES[state.type];
    light.tint = glowHex[T.glow];
    light.alpha = 0.10 + Math.min(0.08, swarm.ants.length / 4000);
    light.position.set(Math.round(swarm.x), Math.round(swarm.y));
    light.width = light.height = swarm.R * 3 + 40;
    view.render(dt);
    frames++;
    busy += performance.now() - t0;
    fpsT += ticker.deltaMS;
    if (fpsT > 500) {
      fpsEl.textContent = `${Math.round((frames * 1000) / fpsT)} fps ・ 計算 ${(busy / frames).toFixed(1)}ms ・ 描画 ${swarm.ants.length}匹 ・ ${view.W}×${view.H}ドット ×${view.scale}`;
      fpsT = 0;
      frames = 0;
      busy = 0;
    }
  });
}

main().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.textContent = '読み込みに失敗しました：' + e.message;
});
