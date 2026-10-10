// 作り直し（v2）のステージを作る。1-1 は手作り、ほかは「ごほうびと危険を近くに並べた型」を乱数で組み合わせる。
// 同じ種なら同じコースになる（今日のコース）。
// 距離はスタートからの道のり（ドット）。群れは CONFIG.lane.speed で進む。
// シロアリの大群はこちらへ歩いてくるので、「群れと出会う場所」より奥に置く（meet）。
import { CONFIG } from './config.js';
import { rngFor } from '../core/rng.js';

export const AREAS = ['garden', 'forest', 'hive'];
const WEAPONS = ['mandible', 'fire', 'bullet', 'bomb'];
const R1_STAGES = 4;       // R1（遊びの芯の確認）はエリア1のふつうのステージ4つ
const MEET = 150;          // 大群が現れてから群れと出会うまでに、群れが進むぶんの目安
// 横の位置と幅は、幅340の道で考えた値を、いまの道の幅に合わせて縮める
const DESIGN_W = 340;
const SX = CONFIG.track.width / DESIGN_W;

const horde = (meet, x, n, w) => ({ y: meet + MEET, kind: 'horde', x: Math.round(x), n: Math.max(1, Math.round(n)), w });
const egg = (y, x, hp, n) => ({ y, kind: 'egg', x: Math.round(x), hp: Math.round(hp), n: Math.round(n) });

// ---------------------------------------------------------------------------
// 1-1（手作り）：5秒以内に卵と小さな大群、10秒以内に変異、真ん中で大きな大群
// ---------------------------------------------------------------------------
function firstCourse() {
  const ev = [
    { ...egg(260, -70, 10, 8), hint: 'egg' },
    { ...horde(330, 75, 16, 40), hint: 'horde' },
    { y: 620, kind: 'cocoon', x: 0, mut: 'fire', hp: 30 },
    horde(720, 0, 36, 70),
    { y: 1000, kind: 'plus', x: 115, n: 6, v: 1, hint: 'plus' },
    egg(1060, -90, 16, 10),
    horde(880, -95, 8, 30),
    horde(1250, 85, 10, 34),
    horde(1450, 0, 120, 200),
    egg(1720, 100, 20, 12),
    { y: 1880, kind: 'cocoon', x: -20, mut: 'fire', hp: 40 },
    horde(1740, -80, 30, 54),
    horde(1960, 30, 12, 40),
    { y: 2050, kind: 'board', x: -40, v: -10, hint: 'board' },
    egg(2080, 115, 14, 8),
    { y: 2340, kind: 'beetle', x: -60, hp: CONFIG.gas.beetleHp[0], hint: 'beetle' },
    egg(2400, 90, 18, 10),
    horde(2520, 40, 50, 90),
  ];
  return { events: ev, length: 2850 };
}

function pickMut(rng, s) {
  if (s > 0 && rng() < 0.2) return 'armor';
  return WEAPONS[Math.floor(rng() * WEAPONS.length)];
}

// ---------------------------------------------------------------------------
// 型：どれも「ごほうび（卵・繭・＋）」と「危険（大群・予告・看板）」を近くに置き、どちらを撃つかを選ばせる
// ---------------------------------------------------------------------------
const PATTERNS = {
  cocoon(y, d, rng, side, s) {
    const x = Math.round((rng() - 0.5) * 120);
    return { len: 340, ev: [
      { y: y + 40, kind: 'cocoon', x, mut: pickMut(rng, s), hp: 32 + 8 * d },
      horde(y + 130, x * 0.6, 16 * (1 + 0.3 * d), 70),
    ] };
  },
  cocoon2(y, d, rng, side, s) {
    const m1 = pickMut(rng, s);
    let m2 = pickMut(rng, s);
    if (m2 === m1) m2 = m1 === 'armor' ? 'fire' : 'armor';
    return { len: 360, ev: [
      { y: y + 40, kind: 'cocoon', x: -85, mut: m1, hp: 32 + 8 * d },
      { y: y + 40, kind: 'cocoon', x: 85, mut: m2, hp: 32 + 8 * d },
      horde(y + 140, -85, 10 * (1 + 0.3 * d), 50),
      horde(y + 140, 85, 10 * (1 + 0.3 * d), 50),
    ] };
  },
  eggHorde(y, d, rng, side) {
    return { len: 300, ev: [
      egg(y + 40, side * 80, 14 + 5 * d, 9 + 2 * d),
      horde(y + 60, -side * 75, 18 * (1 + 0.3 * d), 80),
    ] };
  },
  eggGuard(y, d, rng, side) {
    return { len: 300, ev: [
      egg(y + 70, side * 40, 16 + 5 * d, 11 + 2 * d),
      horde(y + 30, side * 40, 14 * (1 + 0.3 * d), 54),
    ] };
  },
  plusVsEgg(y, d, rng, side) {
    const n = 5 + d;
    return { len: 320, ev: [
      { y: y + 20, kind: 'plus', x: side * 115, n, v: 1 },
      egg(y + 80, -side * 80, 16 + 5 * d, 10 + 2 * d),
      horde(y + 110, -side * 60, 10 * (1 + 0.3 * d), 50),
    ] };
  },
  wave(y, d) {
    const n = 8 * (1 + 0.3 * d);
    return { len: 320, ev: [
      horde(y + 40, -110, n, 40),
      horde(y + 110, 0, n, 40),
      horde(y + 180, 110, n, 40),
    ] };
  },
  bigHorde(y, d, rng, side) {
    return { len: 420, ev: [
      horde(y + 140, 0, 100 * (1 + 0.3 * d), 200),
      egg(y + 300, side * 90, 18 + 5 * d, 12 + 2 * d),
    ] };
  },
  board(y, d, rng) {
    const v = -(8 + 4 * d);
    return { len: 280, ev: [
      { y: y + 60, kind: 'board', x: Math.round((rng() - 0.5) * 100), v },
      egg(y + 100, -112, 10 + 3 * d, 6),
      egg(y + 100, 112, 10 + 3 * d, 6),
    ] };
  },
  rocks(y, d, rng, side) {
    return { len: 300, ev: [
      { y: y + 60, kind: 'rock', x: side * 60, r: CONFIG.rock.radii[1], variant: Math.floor(rng() * 3) },
      { y: y + 160, kind: 'rock', x: -side * 100, r: CONFIG.rock.radii[2], variant: Math.floor(rng() * 3) },
      horde(y + 130, -side * 20, 14 * (1 + 0.3 * d), 60),
      egg(y + 220, side * 110, 14 + 4 * d, 8 + d),
    ] };
  },
  beetle(y, d, rng, side) {
    return { len: 320, ev: [
      { y: y + 80, kind: 'beetle', x: side * 60, hp: CONFIG.gas.beetleHp[Math.min(3, d)] },
      egg(y + 60, -side * 85, 14 + 4 * d, 9 + 2 * d),
    ] };
  },
  gold(y, d, rng, side) {
    return { len: 300, ev: [
      horde(y + 40, side * 90, 20 * (1 + 0.3 * d), 60),
      { y: y + 90, kind: 'gold', x: side * 90 },
    ] };
  },
};

function genCourse(s, seed) {
  const rng = rngFor(seed + ':lane:' + s);
  const d = s;   // 難しさ（1-2 = 1 … 1-4 = 3）
  const pick = (...names) => names[Math.floor(rng() * names.length)];
  // 並び：はじめに卵と小さな大群 → 繭 → 増やす型 → 大きな大群（山場）→ 危険 → 終盤
  const list = [
    'opening',
    rng() < 0.35 ? 'cocoon2' : 'cocoon',
    pick('eggHorde', 'eggGuard'),
    'plusVsEgg',
    pick('wave', 'eggHorde'),
    ...(rng() < 0.3 + 0.1 * d ? ['gold'] : []),
    'bigHorde',
    ...(rng() < 0.65 ? ['cocoon'] : []),
    pick('board', 'rocks'),
    'beetle',
    pick('eggGuard', 'wave'),
    ...(d >= 2 ? ['bigHorde'] : []),
  ];
  const ev = [];
  let y = 240;
  for (const name of list) {
    const side = rng() < 0.5 ? -1 : 1;
    if (name === 'opening') {
      // はじめは群れが小さいので、卵を先に、大群は小さく（始まってすぐ全滅しないように）
      ev.push(egg(y + 20, side * 70, 10 + 2 * d, 8 + d));
      ev.push(horde(y + 140, -side * 70, 8 + 2 * d, 40));
      y += 300;
      continue;
    }
    const p = PATTERNS[name](y, d, rng, side, s);
    ev.push(...p.ev);
    // 型と型の間にも、小さな大群（撃つものが途切れないように）
    if (rng() < 0.6) ev.push(horde(y + p.len * 0.55, (rng() - 0.5) * 230, 6 + 2 * d, 30));
    y += p.len;
  }
  return { events: ev, length: y + 120 };
}

/** ラン全体のステージ（R1：エリア1のふつうのステージ4つ） */
export function buildLaneRun(seed) {
  const stages = [];
  for (let s = 0; s < R1_STAGES; s++) {
    const course = s === 0 ? firstCourse() : genCourse(s, seed);
    for (const ev of course.events) {
      if (ev.x !== undefined) ev.x = Math.round(ev.x * SX);
      if (ev.w !== undefined) ev.w = Math.round(ev.w * SX);
    }
    course.events.push({ y: course.length, kind: 'nest', hp: CONFIG.nest.hp[s], hint: s === 0 ? 'nest' : undefined });
    stages.push({ index: s, area: 0, areaName: AREAS[0], local: s, boss: false, course });
  }
  return stages;
}
