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
    this.killsEl = $('hud-kills');
    this.killsN = $('hud-kills-n');
    this.killsShown = -1;
  }

  /** ランで集めた蜜（右上。入るたびにはねる） */
  honey(n) {
    const el = $('hud-honey');
    if (n === this.honeyShown) return;
    this.honeyShown = n;
    el.textContent = t('honey', { n: fmt(n) });
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /** 撃破数（数字は回るように増える） */
  kills(n) {
    if (n === null) { this.killsEl.classList.add('hidden'); this.killsShown = -1; this.honeyShown = -1; return; }
    if (this.killsShown < 0) {
      this.killsEl.classList.remove('hidden');
      $('hud-kills-l').textContent = t('kills_label');
      this.killsShown = 0;
    }
    if (n === this.killsShown) return;
    this.killsShown = n;
    this.killsN.textContent = fmt(n);
    this.killsEl.classList.remove('bump');
    void this.killsEl.offsetWidth;
    this.killsEl.classList.add('bump');
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setStage(stage, daily = false) {
    const area = t('area_' + stage.areaName);
    const s = stage.boss ? t('boss_stage') : `${stage.area + 1}-${stage.local + 1}`;
    const inv = this.G.run?.invasion ? `  ${t('invasion', { n: this.G.run.invasion })}` : '';
    this.stageEl.textContent = (daily ? t('daily_course') + '  ' : '') + `${s}  ${area}` + inv;
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
  popup(screenX, screenY, text, kind, sub) {
    const el = document.createElement('div');
    el.className = 'pop ' + (kind || '');
    el.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.appendChild(s);
    }
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    this.popLayer.appendChild(el);
    setTimeout(() => el.remove(), (kind || '').startsWith('mutate') ? 2300 : 1300);
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

export function fillResult({ title, sub, reached, maxCount, best, shortBy, shortText = '', good, honey = '', unlock = '', daily = '' }) {
  $('res-honey').textContent = honey;
  $('res-unlock').textContent = unlock;
  $('res-unlock').classList.toggle('hidden', !unlock);
  $('res-daily').textContent = daily;
  $('res-title').textContent = title;
  $('res-title').className = good ? 'good' : 'bad';
  $('res-sub').textContent = sub || '';
  const short = shortText || (shortBy ? t('short_by', { n: fmt(shortBy) }) : '');
  $('res-short').textContent = short;
  $('res-short').classList.toggle('hidden', !short);
  $('res-reached').textContent = t('reached', { where: reached });
  $('res-max').textContent = t('max_count', { n: fmt(maxCount) });
  $('res-best').textContent = best;
}
