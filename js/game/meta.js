// ランの外の仕組み：女王の部屋（蜜で永続強化）・侵攻度・今日のコース・蜜。
import { CONFIG } from './config.js';
import { getSave, save } from './save.js';
import { CARDS, defaultMods, buildMods } from './cards.js';

export const UPGRADE_KEYS = ['startCount', 'damage', 'cocoon', 'range', 'choices'];

export function meta() {
  const d = getSave();
  d.meta = d.meta || {};
  const m = d.meta;
  m.honey ??= 0;
  m.upgrades = { startCount: 0, damage: 0, cocoon: 0, choices: 0, range: 0, ...(m.upgrades || {}) };
  // 作り直し前の「ゲートの上限」に払った蜜は、「弾が届く距離」に移す
  if (m.upgrades.gateCap) { m.upgrades.range = Math.max(m.upgrades.range, m.upgrades.gateCap); delete m.upgrades.gateCap; }
  m.cards ??= [];          // 解放したカード
  m.clears ??= 0;
  m.invasionMax ??= 0;     // 選べる侵攻度の最大（クリアするたびに1段ずつ増える）
  m.invasion ??= 0;        // いま選んでいる侵攻度
  d.daily = { date: '', bestStage: -1, bestCount: 0, ...(d.daily || {}) };
  return m;
}

/** 永続強化の次の段の値段（もう最大なら null） */
export function upgradeCost(key) {
  const m = meta();
  const costs = CONFIG.upgrades[key].costs;
  const lv = m.upgrades[key];
  return lv < costs.length ? costs[lv] : null;
}

export function buyUpgrade(key) {
  const m = meta();
  const c = upgradeCost(key);
  if (c === null || m.honey < c) return false;
  m.honey -= c;
  m.upgrades[key]++;
  save();
  return true;
}

export function lockedCards() {
  const m = meta();
  return CARDS.filter((c) => !c.starter && !m.cards.includes(c.id));
}

export function buyCard(id) {
  const m = meta();
  const c = CARDS.find((x) => x.id === id);
  if (!c || c.starter || m.cards.includes(id) || m.honey < c.cost) return false;
  m.honey -= c.cost;
  m.cards.push(id);
  save();
  return true;
}

/** 日付（端末の日付）。今日のコースの種と記録に使う */
export function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dailyRecord() {
  meta();
  const d = getSave().daily;
  return d.date === todayKey() ? d : { date: todayKey(), bestStage: -1, bestCount: 0 };
}

export function recordDaily(stageIndex, maxCount) {
  meta();
  const s = getSave();
  const today = todayKey();
  if (s.daily.date !== today) s.daily = { date: today, bestStage: -1, bestCount: 0 };
  if (stageIndex > s.daily.bestStage || (stageIndex === s.daily.bestStage && maxCount > s.daily.bestCount)) {
    s.daily.bestStage = stageIndex;
    s.daily.bestCount = Math.round(maxCount);
  }
  save();
}

/**
 * ランの始めの設定。
 * mode: 'normal'（女王の部屋の強化と侵攻度が効く） / 'daily'（今日のコース：全員同じ条件。強化なし・侵攻度0・全部のカード）
 */
export function runSetup(mode) {
  const m = meta();
  const U = CONFIG.upgrades;
  if (mode === 'daily') {
    const key = todayKey();
    return {
      mode, seed: 'daily:' + key, date: key, invasion: 0,
      startCount: CONFIG.run.startCount,
      base: defaultMods(),
      choices: CONFIG.cards.choices,
      pool: CARDS.map((c) => c.id),
    };
  }
  const base = defaultMods();
  base.dmgMul *= 1 + U.damage.per * m.upgrades.damage;
  base.cocoonDmg *= 1 + U.cocoon.per * m.upgrades.cocoon;
  base.rangeMul *= 1 + U.range.per * m.upgrades.range;
  return {
    mode, seed: 'run:' + Date.now(), date: null,
    invasion: Math.min(m.invasion, m.invasionMax),
    startCount: CONFIG.run.startCount + U.startCount.per * m.upgrades.startCount,
    base,
    choices: CONFIG.cards.choices + (m.upgrades.choices > 0 ? 1 : 0),
    pool: CARDS.filter((c) => c.starter || m.cards.includes(c.id)).map((c) => c.id),
  };
}

/** ランの補正（カード＋強化）を作り直す */
export function refreshMods(run) {
  run.mods = buildMods(run.cards, run.base);
}

/** 侵攻度による強さの倍率 */
export function inv(run, key) {
  return 1 + (run?.invasion || 0) * CONFIG.invasion[key];
}

/** 蜜を足す（侵攻度とカードで増える） */
export function addHoney(run, amount) {
  if (!run || amount <= 0) return;
  const mul = (1 + (run.invasion || 0) * CONFIG.honey.perInvasion) * (run.mods?.honeyMul ?? 1);
  run.honey = (run.honey || 0) + amount * mul;
}

/** ランが終わったとき：蜜を貯め、クリアなら侵攻度を解放する。戻り値：{honey, unlocked} */
export function finishRun(run, cleared) {
  const m = meta();
  const honey = Math.round(run.honey || 0);
  m.honey += honey;
  let unlocked = null;
  if (cleared && run.mode === 'normal') {
    m.clears++;
    if (run.invasion >= m.invasionMax && m.invasionMax < CONFIG.invasion.max) {
      m.invasionMax++;
      unlocked = m.invasionMax;
    }
  }
  save();
  return { honey, unlocked };
}
