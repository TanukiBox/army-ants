// 画面の表示（文字・ボタン）：ステージ名、変異の枠、ボスの体力、大きな見出し、ポップアップ、各画面。
// 文字は日英を切り替えられるよう、すべて i18n.js の t() から取る。
import { t, fmt } from './i18n.js';
import { MUT_COLOR } from './mutation.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  constructor(G) {
    this.G = G;
    this.root = $('hud');
    this.stageEl = $('hud-stage');
    this.weaponEl = $('hud-weapon');
    this.armorEl = $('hud-armor');
    this.bossEl = $('boss');
    this.bossName = $('boss-name');
    this.bossFill = $('boss-fill');
    this.bannerEl = $('banner');
    this.popLayer = $('pops');
    this.flashEl = $('flash');
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setStage(stage) {
    const area = t('area_' + stage.areaName);
    const s = stage.boss ? t('boss_stage') : `${stage.area + 1}-${stage.local + 1}`;
    this.stageEl.textContent = `${s}  ${area}`;
  }

  refresh() {
    const run = this.G.run;
    if (!run) return;
    const w = run.weapon;
    this.weaponEl.innerHTML = w
      ? `<i style="background:${hex(MUT_COLOR[w.type])}"></i>${t('mut_' + w.type)} <b>${t('lv', { n: w.lv })}</b>`
      : `<i class="empty"></i>${t('weapon')}: ${t('none')}`;
    this.armorEl.innerHTML = run.armor
      ? `<i style="background:${hex(MUT_COLOR.armor)}"></i>${t('mut_armor')} <b>${t('lv', { n: run.armor })}</b>`
      : `<i class="empty"></i>${t('armor')}: ${t('none')}`;
  }

  bossBar(name, ratio = 1) {
    if (!name) { this.bossEl.classList.add('hidden'); return; }
    this.bossEl.classList.remove('hidden');
    this.bossName.textContent = name;
    this.bossFill.style.width = Math.max(0, ratio * 100).toFixed(1) + '%';
  }

  banner(text, kind = '', sub = '') {
    const el = this.bannerEl;
    el.className = 'banner ' + kind;
    el.innerHTML = `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void el.offsetWidth;   // アニメーションをやり直す
    el.classList.add('show');
  }

  /** 世界の位置（ドット）に、ふわっと上がる文字 */
  popup(screenX, screenY, text, kind) {
    const el = document.createElement('div');
    el.className = 'pop ' + (kind || '');
    el.textContent = text;
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    this.popLayer.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  flash(color, strength = 0.3) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = hex(color);
    el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = 'opacity 0.35s ease-out';
    el.style.opacity = '0';
  }
}

// =============================================================================
// 画面（タイトル・一時停止・設定・結果）
// =============================================================================
export function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
}

export function hideScreens() {
  for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
}

export function fillResult({ title, sub, reached, maxCount, best, shortBy, good }) {
  $('res-title').textContent = title;
  $('res-title').className = good ? 'good' : 'bad';
  $('res-sub').textContent = sub || '';
  $('res-short').textContent = shortBy ? t('short_by', { n: fmt(shortBy) }) : '';
  $('res-short').classList.toggle('hidden', !shortBy);
  $('res-reached').textContent = t('reached', { where: reached });
  $('res-max').textContent = t('max_count', { n: fmt(maxCount) });
  $('res-best').textContent = best;
}
