// ステージを作る（参考動画に寄せた版）。1-1 は手作り、ほかは「ごほうびと敵を近くに並べた型」を乱数で組み合わせる。
// 同じ種なら同じコースになる（今日のコース）。
// 距離はスタートからの道のり（ドット）。横の位置は道のまんなかが 0（はしは ±CONFIG.track.width/2）。
// シロアリはこちらへ歩いてくるので、「群れと出会う場所」より奥に置く（meet）。
// ステージの最後は巣：群れが着くと、残りのシロアリ（守り）が出てくる。全部倒すとクリア。
import { CONFIG } from './config.js';
import { rngFor } from '../core/rng.js';

export const AREAS = ['garden', 'forest', 'hive'];
const WEAPONS = ['mandible', 'fire', 'bullet', 'bomb'];
const STAGES = 4;          // いまはエリア1のふつうのステージ4つ
const MEET = 150;          // 敵が現れてから群れと出会うまでに、敵が歩くぶんの目安

const egg = (y, x, hp, n) => ({ y, kind: 'egg', x: Math.round(x), hp: Math.round(hp), n: Math.max(1, Math.round(n * CONFIG.egg.rewardMul)) });
const horde = (meet, x, n, w) => ({ y: meet + MEET, kind: 'horde', x: Math.round(x), n: Math.max(1, Math.round(n)), w });
const soldiers = (meet, x, n, hp, spread = 0) => ({ y: meet + MEET, kind: 'soldiers', x: Math.round(x), n: Math.round(n), hp: Math.round(hp * CONFIG.soldier.hpMul), spread });

// ---------------------------------------------------------------------------
// 1-1（手作り）：はじめは1匹でも割れる卵、すぐに兵隊シロアリ、ヒアリの繭、＋の道、捕らわれた兵隊アリ…
// ---------------------------------------------------------------------------
function firstCourse() {
  const ev = [
    { ...egg(110, -36, 4, 3), hint: 'egg' },
    egg(150, 36, 7, 4),
    { ...soldiers(320, 0, 2, 2), hint: 'soldier' },
    { y: 400, kind: 'cocoon', x: 38, mut: 'fire', hp: 20 },
    { y: 470, kind: 'plus', x: -58, n: 10, hint: 'plus' },
    egg(560, 40, 14, 4),
    horde(700, 30, 24, 46),
    { y: 820, kind: 'board', x: -30, v: -8, hint: 'board' },
    egg(860, 46, 18, 5),
    { y: 1020, kind: 'cage', x: 48, hp: 90, hint: 'cage' },
    soldiers(1080, -36, 5, 5),
    { y: 1240, kind: 'beetle', x: -44, hp: 10, hint: 'beetle' },
    egg(1300, -44, 16, 4),
    { y: 1420, kind: 'cocoon', x: 30, mut: 'fire', hp: 30 },
    horde(1580, 0, 50, 100),
    { y: 1700, kind: 'plus', x: 58, n: 8 },
    egg(1730, -44, 24, 6),
    soldiers(1880, 26, 6, 6),
    { y: 2000, kind: 'board', x: 38, v: -12 },
    egg(2020, -48, 18, 5),
    horde(2200, -26, 30, 56),
    { y: 2350, kind: 'beetle', x: 40, hp: 12 },
  ];
  return { events: ev, length: 2560, garrison: { soldiers: 10, soldierHp: 6, workers: 20 } };
}

function pickMut(rng, s) {
  if (s > 0 && rng() < 0.2) return 'armor';
  return WEAPONS[Math.floor(rng() * WEAPONS.length)];
}

// ---------------------------------------------------------------------------
// 型：どれも「ごほうび（卵・繭・＋・兵隊アリ）」と「敵」を近くに置き、どちらを撃つかを選ばせる
// ---------------------------------------------------------------------------
const PATTERNS = {
  cocoon(y, d, rng, side, s) {
    const x = Math.round((rng() - 0.5) * 80);
    return { len: 230, ev: [
      { y: y + 40, kind: 'cocoon', x, mut: pickMut(rng, s), hp: 22 + 8 * d },
      soldiers(y + 100, x * 0.5, 2 + d, 4 + d, 12),
    ] };
  },
  cocoon2(y, d, rng, side, s) {
    const m1 = pickMut(rng, s);
    let m2 = pickMut(rng, s);
    if (m2 === m1) m2 = m1 === 'armor' ? 'fire' : 'armor';
    return { len: 250, ev: [
      { y: y + 40, kind: 'cocoon', x: -46, mut: m1, hp: 22 + 8 * d },
      { y: y + 40, kind: 'cocoon', x: 46, mut: m2, hp: 22 + 8 * d },
      horde(y + 110, -46, 6 + 2 * d, 28),
      horde(y + 110, 46, 6 + 2 * d, 28),
    ] };
  },
  eggHorde(y, d, rng, side) {
    return { len: 220, ev: [
      egg(y + 40, side * 44, 12 + 5 * d, 3 + d),
      horde(y + 60, -side * 40, 16 + 5 * d, 40),
    ] };
  },
  eggGuard(y, d, rng, side) {
    return { len: 220, ev: [
      egg(y + 70, side * 30, 16 + 5 * d, 4 + d),
      soldiers(y + 30, side * 30, 3 + d, 4 + d, 14),
    ] };
  },
  plusVsEgg(y, d, rng, side) {
    return { len: 260, ev: [
      { y: y + 20, kind: 'plus', x: side * 58, n: 6 + d },
      egg(y + 70, -side * 44, 14 + 5 * d, 4 + d),
      soldiers(y + 110, -side * 30, 3, 4 + d),
    ] };
  },
  column(y, d, rng) {
    // 兵隊シロアリの行列（参考動画の、盾を持った兵士の列）
    return { len: 240, ev: [
      soldiers(y + 60, Math.round((rng() - 0.5) * 80), 6 + 2 * d, 4 + d),
    ] };
  },
  wave(y, d) {
    const n = 6 + 2 * d;
    return { len: 230, ev: [
      horde(y + 30, -55, n, 28),
      horde(y + 80, 0, n, 28),
      horde(y + 130, 55, n, 28),
    ] };
  },
  bigHorde(y, d, rng, side) {
    return { len: 300, ev: [
      horde(y + 100, 0, 44 + 14 * d, 110),
      egg(y + 230, side * 46, 20 + 5 * d, 5 + d),
    ] };
  },
  board(y, d, rng) {
    return { len: 200, ev: [
      { y: y + 50, kind: 'board', x: Math.round((rng() - 0.5) * 60), v: -(6 + 3 * d) },
      egg(y + 80, -62, 8 + 2 * d, 2),
      egg(y + 80, 62, 8 + 2 * d, 2),
    ] };
  },
  rocks(y, d, rng, side) {
    return { len: 220, ev: [
      { y: y + 50, kind: 'rock', x: side * 40, r: CONFIG.rock.radii[2], variant: Math.floor(rng() * 3) },
      { y: y + 130, kind: 'rock', x: -side * 60, r: CONFIG.rock.radii[2], variant: Math.floor(rng() * 3) },
      horde(y + 100, -side * 10, 10 + 3 * d, 40),
      egg(y + 170, side * 62, 12 + 4 * d, 3 + d),
    ] };
  },
  beetle(y, d, rng, side) {
    return { len: 240, ev: [
      { y: y + 70, kind: 'beetle', x: side * 40, hp: 10 + 3 * d },
      egg(y + 50, -side * 46, 14 + 4 * d, 3 + d),
    ] };
  },
  cage(y, d, rng, side) {
    return { len: 250, ev: [
      { y: y + 60, kind: 'cage', x: side * 46, hp: 80 + 25 * d },
      soldiers(y + 70, -side * 20, 3 + d, 4 + d, 12),
    ] };
  },
};

function genCourse(s, seed) {
  const rng = rngFor(seed + ':lane:' + s);
  const d = s;   // 難しさ（1-2 = 1 … 1-4 = 3）
  const pick = (...names) => names[Math.floor(rng() * names.length)];
  const list = [
    'opening',
    rng() < 0.35 ? 'cocoon2' : 'cocoon',
    pick('eggHorde', 'eggGuard'),
    'plusVsEgg',
    'column',
    pick('wave', 'eggHorde'),
    ...(rng() < 0.5 ? ['cage'] : []),
    'bigHorde',
    ...(rng() < 0.65 ? ['cocoon'] : []),
    pick('board', 'rocks'),
    'beetle',
    pick('eggGuard', 'column'),
    ...(d >= 2 ? ['bigHorde'] : []),
  ];
  const ev = [];
  let y = 110;
  for (const name of list) {
    const side = rng() < 0.5 ? -1 : 1;
    if (name === 'opening') {
      // はじめは群れが小さいので、割りやすい卵を先に、敵は少なく
      ev.push(egg(y, side * 36, 4 + d, 3));
      ev.push(egg(y + 40, -side * 36, 8 + 2 * d, 4));
      ev.push(soldiers(y + 210, 0, 2, 2));
      y += 260;
      continue;
    }
    const p = PATTERNS[name](y, d, rng, side, s);
    ev.push(...p.ev);
    // 型と型の間にも、小さな群れ（撃つものが途切れないように）
    if (rng() < 0.5) ev.push(horde(y + p.len * 0.55, (rng() - 0.5) * 120, 4 + 2 * d, 22));
    y += p.len;
  }
  return { events: ev, length: y + 150, garrison: { soldiers: 10 + 3 * d, soldierHp: 6 + d, workers: 20 + 6 * d } };
}

/** ラン全体のステージ（いまはエリア1のふつうのステージ4つ） */
export function buildLaneRun(seed) {
  const stages = [];
  for (let s = 0; s < STAGES; s++) {
    const course = s === 0 ? firstCourse() : genCourse(s, seed);
    const g = course.garrison;
    course.events.push({ y: course.length, kind: 'nest', soldiers: g.soldiers, soldierHp: Math.round(g.soldierHp * CONFIG.soldier.hpMul), workers: g.workers, hint: s === 0 ? 'nest' : undefined });
    stages.push({ index: s, area: 0, areaName: AREAS[0], local: s, boss: false, course });
  }
  return stages;
}
