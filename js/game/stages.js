// ステージ（コース）を作る。1-1 は手で作った「かすり取り」に気づけるコース。
// ほかは決まった型を、ステージごとの乱数で組み合わせて作る（同じ種なら同じコースになる）。
import { CONFIG } from './config.js';
import { rngFor } from '../core/rng.js';

export const AREAS = ['garden', 'forest', 'hive'];
export const BOSSES = ['mantis', 'spider', 'hornet'];
export const WEAPON_KINDS = ['mandible', 'fire', 'bullet', 'bomb'];

const HALF = CONFIG.track.width / 2;

/** 見やすい数にそろえる（5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150 …） */
export function nice(v) {
  const s = Math.sign(v) || 1;
  v = Math.abs(v);
  if (v < 5) return s * Math.max(1, Math.round(v));
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80];
  let mag = 1;
  while (v >= 100 * mag) mag *= 10;
  const base = v / mag;
  let best = steps[0];
  for (const st of steps.concat([100])) if (Math.abs(st - base) < Math.abs(best - base)) best = st;
  return s * best * mag;
}

export function expectedAt(s) {
  return CONFIG.balance.expectedStart * Math.pow(CONFIG.balance.expectedGrowth, s);
}

function addGate(v, E) {
  const cap = v > 0 ? nice(v * CONFIG.gate.posCapRatio) : Math.max(1, nice(Math.abs(v) * CONFIG.gate.negCapRatio));
  return { op: 'add', v, cap };
}
function mulGate(m) {
  // ×2 は撃つと ×3 まで、÷ は撃つと ×2 まで上がる（×3 はそのまま）
  return { op: 'mul', v: m, cap: m < 0 ? 2 : Math.max(m, 3) };
}

/** ゲートの並び（左から右へ、x0〜x1 の範囲） */
function row(y, parts) {
  return { y, kind: 'gates', gates: parts };
}

// ---------------------------------------------------------------------------
// 1-1：はじめてのコース（手作り）
// ---------------------------------------------------------------------------
function firstStage() {
  const E = expectedAt(0);
  const g = CONFIG.runner.segmentGap;
  let y = CONFIG.runner.introGap;
  const ev = [];
  // 群れのスタート位置（真ん中）が＋と×の境目：最初から自然に「かすり取り」になる
  ev.push(row(y, [{ x0: -HALF, x1: 0, ...addGate(10, E) }, { x0: 0, x1: HALF, ...mulGate(2) }]));
  y += g;
  ev.push(row(y, [{ x0: -HALF, x1: -55, ...addGate(-10, E) }, { x0: -55, x1: 55, ...addGate(20, E) },
                  { x0: 55, x1: HALF, ...addGate(10, E) }]));
  y += g;
  ev.push({ y, kind: 'cocoon', x: 0, mut: 'fire', hp: 26 });
  y += g;
  // まん中の×2は群れより細い：両側の＋にもかすらせられる
  ev.push(row(y, [{ x0: -HALF, x1: -26, ...addGate(15, E) }, { x0: -26, x1: 26, ...mulGate(2) },
                  { x0: 26, x1: HALF, ...addGate(15, E) }]));
  y += g;
  ev.push({ y, kind: 'termites', x: 40, n: 20, ratio: 0.2 });
  y += g * 0.8;
  ev.push({ y, kind: 'rock', x: -110, r: CONFIG.rock.radii[1], variant: 1 });
  ev.push(row(y + 60, [{ x0: -HALF, x1: -10, ...addGate(25, E) }, { x0: -10, x1: HALF, ...addGate(-20, E) }]));
  y += g + 60;
  ev.push({ y, kind: 'termites', x: -95, n: 14, ratio: 0.12 });
  ev.push({ y: y + 70, kind: 'termites', x: 95, n: 14, ratio: 0.12 });
  y += g;
  return { events: ev, length: y + CONFIG.runner.outroGap };
}

// ---------------------------------------------------------------------------
// ふつうのステージ（型を組み合わせる）
// ---------------------------------------------------------------------------
function genGates(rng, y, E, s, mulOk = true) {
  const a = () => nice(E * (0.35 + rng() * 0.7));
  const b = () => -nice(E * (0.3 + rng() * 0.45));
  const m = () => (rng() < 0.12 + s * 0.01 ? 3 : 2);
  if (!mulOk) {
    // ×÷なし：＋−だけ（選び方とかすり取りで差がつく）
    const split = Math.round((rng() - 0.5) * 140);
    const opts = [[addGate(a(), E), addGate(b(), E)], [addGate(a(), E), addGate(a(), E)], [addGate(b(), E), addGate(a(), E)]];
    const [L, R] = opts[Math.floor(rng() * opts.length)];
    if (rng() < 0.5) return row(y, [{ x0: -HALF, x1: split, ...L }, { x0: split, x1: HALF, ...R }]);
    const w = 70 + Math.round(rng() * 60);
    return row(y, [{ x0: -HALF, x1: split - w / 2, ...L }, { x0: split - w / 2, x1: split + w / 2, ...addGate(a(), E) },
                   { x0: split + w / 2, x1: HALF, ...R }]);
  }
  const t = rng();
  if (t < 0.35) {
    // 2つ：境目に「かすり取り」の余地
    const split = Math.round((rng() - 0.5) * 120);
    const opts = [[addGate(a(), E), mulGate(m())], [mulGate(m()), addGate(b(), E)], [addGate(a(), E), addGate(b(), E)],
                  [mulGate(-2), addGate(a(), E)], [mulGate(m()), mulGate(-2)]];
    const [L, R] = opts[Math.floor(rng() * opts.length)];
    const swap = rng() < 0.5;
    return row(y, [{ x0: -HALF, x1: split, ...(swap ? R : L) }, { x0: split, x1: HALF, ...(swap ? L : R) }]);
  }
  if (t < 0.8) {
    // 3つ：真ん中が細い
    const w = 60 + Math.round(rng() * 70);
    const c = Math.round((rng() - 0.5) * 80);
    const sides = [[addGate(a(), E), addGate(b(), E)], [addGate(a(), E), mulGate(-2)], [addGate(b(), E), addGate(b(), E)],
                   [addGate(a(), E), addGate(a(), E)]];
    const [L, R] = sides[Math.floor(rng() * sides.length)];
    const mid = rng() < 0.75 ? mulGate(m()) : addGate(a(), E);
    const swap = rng() < 0.5;
    return row(y, [{ x0: -HALF, x1: c - w / 2, ...(swap ? R : L) }, { x0: c - w / 2, x1: c + w / 2, ...mid },
                   { x0: c + w / 2, x1: HALF, ...(swap ? L : R) }]);
  }
  // 1つだけ（ほかは素通り）：細い×ゲートと、その横の＋
  const c = Math.round((rng() - 0.5) * 160);
  const w = 70 + Math.round(rng() * 40);
  const parts = [{ x0: c - w / 2, x1: c + w / 2, ...mulGate(m()) }];
  const side = c > 0 ? -1 : 1;
  parts.push(side < 0 ? { x0: c - w / 2 - 70, x1: c - w / 2, ...addGate(a(), E) }
                      : { x0: c + w / 2, x1: c + w / 2 + 70, ...addGate(a(), E) });
  parts.sort((p, q) => p.x0 - q.x0);
  return row(y, parts);
}

function pickMut(rng, s) {
  const r = rng();
  if (r < 0.2 && s > 0) return 'armor';
  return WEAPON_KINDS[Math.floor(rng() * WEAPON_KINDS.length)];
}

function cocoonHp(s) {
  return CONFIG.cocoon.hpBase + CONFIG.cocoon.hpPerStage * s;
}

function genStage(s, seed) {
  if (s === 0) return firstStage();
  const rng = rngFor(seed + ':stage:' + s);
  const area = Math.floor(s / CONFIG.run.stagesPerArea);
  const local = s % CONFIG.run.stagesPerArea;
  const boss = local === CONFIG.run.stagesPerArea - 1;
  const E = expectedAt(s);
  const g = CONFIG.runner.segmentGap;
  let y = CONFIG.runner.introGap;
  const ev = [];
  const segs = [];
  const nGates = boss ? 3 : 4 + (rng() < 0.4 ? 1 : 0);
  for (let i = 0; i < nGates; i++) segs.push('gates');
  segs.push(rng() < 0.4 ? 'cocoon2' : 'cocoon');
  // 敵：エリアが進むほど多い。シロアリの群れ・シロアリの波（いくつもの小さな群れ）・ゴミムシ
  const enemies = boss ? 2 : 2 + area + (rng() < 0.4 ? 1 : 0);
  for (let i = 0; i < enemies; i++) {
    const r = rng();
    segs.push(s < 1 ? 'termites' : r < 0.38 ? 'termites' : r < 0.7 ? 'wave' : 'beetle');
  }
  if (!boss && rng() < 0.5 + area * 0.2) segs.push(s >= 2 && rng() < 0.5 ? 'puddle' : 'rocks');
  // 並べ替え（最初はゲート、繭は前半〜真ん中）
  const order = [segs.shift()];
  while (segs.length) order.push(segs.splice(Math.floor(rng() * segs.length), 1)[0]);
  let mulRows = 0;
  const gates = (yy) => {
    const ok = mulRows < CONFIG.gate.maxMulRows && rng() < 0.6;
    const r = genGates(rng, yy, E, s, ok);
    if (r.gates.some((g) => g.op === 'mul')) mulRows++;
    return r;
  };
  for (const kind of order) {
    if (kind === 'gates') {
      ev.push(gates(y));
    } else if (kind === 'cocoon') {
      ev.push({ y, kind: 'cocoon', x: Math.round((rng() - 0.5) * 140), mut: pickMut(rng, s), hp: cocoonHp(s) });
    } else if (kind === 'cocoon2') {
      const m1 = pickMut(rng, s);
      let m2 = pickMut(rng, s);
      if (m2 === m1) m2 = m1 === 'armor' ? 'fire' : 'armor';
      ev.push({ y, kind: 'cocoon', x: -85, mut: m1, hp: cocoonHp(s) });
      ev.push({ y, kind: 'cocoon', x: 85, mut: m2, hp: cocoonHp(s) });
    } else if (kind === 'termites') {
      const n = Math.max(5, Math.round(E * (0.3 + rng() * 0.35)));
      const [r0, r1] = CONFIG.termites.countRatio;
      ev.push({ y, kind: 'termites', x: Math.round((rng() - 0.5) * 200), n, ratio: r0 + rng() * (r1 - r0) });
      // 手前にゲート：シロアリに向かって撃つか、ゲートを育てるか
      if (rng() < 0.5) ev.push(gates(y + 120));
    } else if (kind === 'wave') {
      // シロアリの波：小さな群れが左右にずれて並ぶ。すき間をすり抜けるか、撃って道を開ける
      const k = 2 + Math.floor(rng() * 2) + (area >= 2 ? 1 : 0);
      const [r0, r1] = CONFIG.termites.countRatio;
      for (let i = 0; i < k; i++) {
        const x = Math.round(-HALF + 50 + (HALF * 2 - 100) * ((i + 0.5) / k) + (rng() - 0.5) * 30);
        ev.push({ y: y + i * 55 * (rng() < 0.5 ? 1 : -1) + 40, kind: 'termites', x,
                  n: Math.max(4, Math.round(E * (0.1 + rng() * 0.1))), ratio: (r0 + rng() * (r1 - r0)) * 0.4 });
      }
    } else if (kind === 'beetle') {
      const n = rng() < 0.3 + area * 0.2 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        ev.push({ y: y - k * 50, kind: 'beetle', x: Math.round((n === 1 ? (rng() - 0.5) * 180 : (k ? 90 : -90))),
                  hp: CONFIG.beetle.hpBase + CONFIG.beetle.hpPerStage * s });
      }
      ev.push({ y: y + 40, kind: 'rock', x: Math.round((rng() - 0.5) * 220), r: CONFIG.rock.radii[1], variant: 1 });
    } else if (kind === 'rocks') {
      const n = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const v = Math.floor(rng() * 3);
        ev.push({ y: y + Math.round((rng() - 0.5) * 60), kind: 'rock', x: Math.round(-HALF + 40 + rng() * (HALF * 2 - 80)),
                  r: CONFIG.rock.radii[v], variant: v });
      }
    } else if (kind === 'puddle') {
      const v = Math.floor(rng() * 2);
      ev.push({ y, kind: 'puddle', x: Math.round((rng() - 0.5) * 160), variant: v,
                rx: [54, 44][v], ry: [26, 21][v] });
      ev.push(gates(y + 130));
    }
    y += g;
  }
  return { events: ev, length: y + CONFIG.runner.outroGap };
}

/** 攻城の設定（動くゲートと敵の巣の耐久） */
function genSiege(s, seed) {
  const rng = rngFor(seed + ':siege:' + s);
  const area = Math.floor(s / CONFIG.run.stagesPerArea);
  const E = expectedAt(s);
  const hp = Math.max(30, nice(E * CONFIG.siege.hpRatio * (s === 0 ? 0.9 : 1)));
  const gates = [];
  const n = s === 0 ? 1 : 1 + (rng() < 0.5 + area * 0.25 ? 1 : 0) + (area >= 2 && rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    gates.push({
      t: 0.30 + 0.42 * (n === 1 ? 0.5 : i / (n - 1)),      // 縦の位置（0 = 敵の巣、1 = 自分の巣）
      w: 70 + Math.round(rng() * 30),
      m: rng() < 0.3 + area * 0.15 ? 3 : 2,
      speed: 0.35 + rng() * 0.45 + area * 0.1,              // 左右に動く速さ
      phase: rng() * Math.PI * 2,
    });
  }
  return { hp, gates, defenders: s === 0 ? 0 : Math.max(3, Math.round(hp * CONFIG.siege.defenderRatio)) };
}

/** ラン全体の15ステージを作る */
export function buildRun(seed) {
  const stages = [];
  const total = CONFIG.run.areas * CONFIG.run.stagesPerArea;
  for (let s = 0; s < total; s++) {
    const area = Math.floor(s / CONFIG.run.stagesPerArea);
    const local = s % CONFIG.run.stagesPerArea;
    const boss = local === CONFIG.run.stagesPerArea - 1;
    const course = genStage(s, seed);
    stages.push({
      index: s, area, areaName: AREAS[area], local, boss, bossKind: boss ? BOSSES[area] : null,
      expected: expectedAt(s), course, siege: boss ? null : genSiege(s, seed),
    });
  }
  return stages;
}
