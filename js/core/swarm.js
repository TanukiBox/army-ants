// アリの群れ：まとまって前へ進み、指の動きに少し遅れて流れるようについてくる。
// 表示するのは最大300匹。それより多い数は、群れを大きく・密にして、頭上の数字で表す。
// 数が増えるときは決めた場所（ゲートなど）から仲間が駆け寄り、減るときは決めた場所のアリから消える。
import { Container, Sprite } from '../../vendor/pixi.min.mjs';
import { PixelText, formatCount } from './pixelfont.js';
import { rngFor } from './rng.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export const SWARM = {
  maxFull: 300,        // くっきり描くアリの数の上限
  maxCarpet: 600,      // 300匹を超えたとき、下に敷く「群れの密度」用のアリの上限
  areaPerAnt: 88,      // 1匹あたりの広さ（ドット²）。小さいほど密集する
  speed: 38,           // 前へ進む速さ（ドット/秒）
  follow: 6.0,         // 群れの中心が指に追いつく速さ
  stride: 2.4,         // 1コマ進む距離（ドット）
  maxHalfWidth: 80,    // 群れの横幅の半分の上限（道の半分より細く：攻撃をよけられるように）
  maxHalfHeight: 118,  // 群れの縦の長さの半分の上限（それより多い数は密度で表す）
};

/** 匹数 → 群れの半径（ドット）。shape で密度を変えられる */
export function swarmRadius(n, shape = SWARM) {
  const m = Math.min(n, SWARM.maxFull);
  let R = Math.sqrt((m * shape.areaPerAnt) / Math.PI);
  if (n > SWARM.maxFull) R *= 1 + 0.3 * Math.log10(n / SWARM.maxFull);
  return R;
}

let antSerial = 0;

export class Swarm {
  constructor(sprites) {
    this.sprites = sprites;
    this.layer = new Container();       // world に入れる
    this.layer.sortableChildren = true;
    this.glowLayer = new Container();   // glow に入れる（加算）
    this.flashLayer = new Container();  // 変異の瞬間に光る影絵（加算）
    this.glowLayer.addChild(this.flashLayer);
    this.label = new PixelText('1', 2);
    this.layer.addChild(this.label);
    this.label.zIndex = 1e9;
    this.ants = [];
    this.count = 0;
    this.variant = 'base';
    this.glowColor = 0xff3a2a;
    this.pulse = 'steady';
    this.glowScale = 1;   // 光の強さ（種類ごと）
    this.x = 0;           // 群れの中心
    this.y = 0;
    this.targetX = 0;
    this.speed = SWARM.speed;
    this.followMul = 1;   // クモの糸などで動きが遅くなるとき 1 より小さく
    this.obstacles = [];  // 群れがよけて流れる丸い物 {x, y, r}
    this.bounds = null;   // 左右のはし {min, max}
    this.onRemove = null; // アリが消えるとき呼ばれる (ant, opts)
    this.R = 0;
    this.time = 0;
    this.sweep = null;    // 変異の光が走っている途中なら
    this.shownCount = 0;
    // 隊形の密度と幅の上限（場面ごとに変えられる）
    this.shape = { areaPerAnt: SWARM.areaPerAnt, maxHalfWidth: SWARM.maxHalfWidth, maxHalfHeight: SWARM.maxHalfHeight };
  }

  /** 隊形の密度と幅の上限を変える（省いた値は元に戻す） */
  setShape(shape = {}) {
    this.shape = { areaPerAnt: SWARM.areaPerAnt, maxHalfWidth: SWARM.maxHalfWidth, maxHalfHeight: SWARM.maxHalfHeight, ...shape };
    this.setCount(this.count);
  }

  setVariant(name, { glowColor, pulse = 'steady', glowScale = 1, sweep = false } = {}) {
    if (name === this.variant && !sweep) return;
    if (sweep && this.ants.length) {
      // 前（上）から後ろへ光が走り、通ったアリから見た目が変わる
      this.sweep = { t: 0, dur: 0.45, next: name, glowColor, pulse, glowScale };
      return;
    }
    this.variant = name;
    if (glowColor !== undefined) this.glowColor = glowColor;
    this.pulse = pulse;
    this.glowScale = glowScale;
    for (const a of this.ants) a.variant = name;
  }

  /**
   * 匹数を決める。
   * opts.from {x,y} … 増えたアリが現れる場所
   * opts.pick(ant) … 減らすときの順番（小さい値のアリから消える）。なければ外側から
   */
  setCount(n, opts = {}) {
    n = Math.max(0, Math.round(n));
    this.count = n;
    const full = Math.min(n, SWARM.maxFull);
    const carpet = n > SWARM.maxFull ? Math.min(SWARM.maxCarpet, Math.round((n - SWARM.maxFull) * 0.065)) : 0;
    const fullAnts = this.ants.filter((a) => !a.carpet);
    const carpetAnts = this.ants.filter((a) => a.carpet);
    this._adjust(fullAnts, full, false, opts);
    this._adjust(carpetAnts, carpet, true, opts);
    this.ants = fullAnts.concat(carpetAnts);
    this.R = swarmRadius(n, this.shape);
    this._assignHomes(fullAnts, carpetAnts);
  }

  _adjust(list, want, carpet, opts) {
    if (list.length > want) {
      const score = opts.pick || ((a) => -Math.hypot(a.x - this.x, (a.y - this.y) * 1.4) + Math.random() * 6);
      list.sort((p, q) => score(p) - score(q));
      const gone = list.splice(0, list.length - want);
      for (const a of gone) {
        this.onRemove?.(a, opts);
        this.removeAnt(a);
      }
    }
    while (list.length < want) {
      const a = this.makeAnt();
      a.carpet = carpet;
      const p = opts.from || { x: this.x, y: this.y };
      const sp = opts.from ? 10 : this.R * 0.5;
      a.x = a.px = p.x + (Math.random() - 0.5) * sp;
      a.y = a.py = p.y + (Math.random() - 0.5) * sp * 0.6;
      a.variant = this.variant;
      list.push(a);
    }
  }

  /** 隊形：ひまわりの種の並び（真ん中は密に、ふちはまばら）。いまの位置に近い場所を割り当てる */
  _assignHomes(fullAnts, carpetAnts) {
    for (const [list, carpet] of [[fullAnts, false], [carpetAnts, true]]) {
      const tot = list.length;
      if (!tot) continue;
      list.sort((p, q) => Math.hypot(p.x - this.x, (p.y - this.y) * 1.4) - Math.hypot(q.x - this.x, (q.y - this.y) * 1.4));
      list.forEach((a, k) => {
        const r = this.R * Math.pow((k + 0.5) / tot, 0.62) * (tot === 1 ? 0 : 1);
        const th = k * GOLDEN + (carpet ? 1.3 : 0);
        const f = this.R > 0 ? r / this.R : 0;
        a.ox = f * Math.cos(th) * this.rx + a.jx;
        a.oy = f * Math.sin(th) * this.ry + a.jy;
        a.spr.tint = carpet ? 0x8a8282 : 0xffffff;
        // 外側・後ろのアリほど遅れてついてくる（流れるように見える）
        const rel = this.R > 0 ? r / this.R : 0;
        a.k = SWARM.follow * (1.35 - 0.55 * rel - 0.25 * Math.max(0, a.oy / Math.max(this.ry, 1))) * a.kk;
      });
    }
  }

  makeAnt() {
    const rng = rngFor('ant' + (antSerial++));
    const spr = new Sprite();
    spr.anchor.set(0.5);
    const glow = new Sprite();
    glow.anchor.set(0.5);
    this.layer.addChild(spr);
    this.glowLayer.addChildAt(glow, 0);
    return {
      spr, glow, flash: null,
      x: this.x, y: this.y, px: this.x, py: this.y, vx: 0, vy: -this.speed, ox: 0, oy: 0, k: 6,
      jx: (rng() - 0.5) * 3, jy: (rng() - 0.5) * 3, kk: 0.85 + rng() * 0.3,
      walk: rng() * 20, dir: 0, variant: this.variant,
      wp: rng() * 6.28, wf: 0.8 + rng() * 0.9, wa: 0.6 + rng() * 1.2,
      lunge: 0,   // 顎で弾くときに前へ出る量
      carpet: false,
    };
  }

  removeAnt(a) {
    a.spr.destroy();
    a.glow.destroy();
    a.flash?.destroy();
  }

  clear() {
    for (const a of this.ants) this.removeAnt(a);
    this.ants = [];
    this.count = 0;
    this.shownCount = 0;
  }

  /** 群れ全体をある場所へ移す（場面が変わるとき） */
  teleport(x, y) {
    const dx = x - this.x, dy = y - this.y;
    this.x = x;
    this.y = y;
    this.targetX = x;
    for (const a of this.ants) { a.x += dx; a.y += dy; a.px += dx; a.py += dy; }
  }

  /** 前（画面の上）にいるアリを k 匹 */
  frontAnts(k) {
    return this.ants.filter((a) => !a.carpet).sort((p, q) => p.y - q.y).slice(0, k);
  }

  randomAnts(k, rng = Math.random) {
    const list = this.ants.filter((a) => !a.carpet);
    const out = [];
    for (let i = 0; i < k && list.length; i++) out.push(list[Math.floor(rng() * list.length)]);
    return out;
  }

  /** 群れの横の半径（ドット）。数が多くても maxHalfWidth より太くならない */
  get rx() { return Math.min(this.R * 1.28, this.shape.maxHalfWidth); }

  /** 群れの縦の半径。横幅が上限に届いたら、その分だけ縦に長くなる（行進の列のように） */
  get ry() {
    const rx0 = this.R * 1.28;
    return Math.min(this.R * 0.74 * rx0 / Math.max(1, this.rx), this.shape.maxHalfHeight);
  }

  /** くっきり描いているアリの数 */
  get shown() {
    let n = 0;
    for (const a of this.ants) if (!a.carpet) n++;
    return n;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.y -= this.speed * dt;
    this.x += (this.targetX - this.x) * (1 - Math.exp(-dt * SWARM.follow * this.followMul));
    const S = this.sprites.ants;

    // 変異の光：前から後ろへ走る
    let sweepY = null;
    const sw = this.sweep;
    if (sw) {
      sw.t += dt;
      sweepY = this.y - this.ry - 12 + Math.min(1, sw.t / sw.dur) * (this.ry * 2 + 24);
    }

    for (const a of this.ants) {
      a.px = a.x;
      a.py = a.y;
      const hx = this.x + a.ox;
      a.x += (hx - a.x) * (1 - Math.exp(-dt * a.k * this.followMul));
      a.lunge = Math.max(0, a.lunge - dt * 40);
      const hy = this.y + a.oy + Math.cos(t * a.wf * 0.7 + a.wp) * a.wa * 0.8 - a.lunge;
      a.y += (hy - a.y) * (1 - Math.exp(-dt * 9));
      // 石などをよけて流れる
      for (const o of this.obstacles) {
        const dx = a.x - o.x, dy = (a.y - o.y) * 1.25;
        const d = Math.hypot(dx, dy), rr = o.r + 3;
        if (d < rr && d > 0.001) {
          a.x = o.x + (dx / d) * rr;
          a.y = o.y + (dy / d) * rr / 1.25;
        }
      }
      if (this.bounds) a.x = Math.max(this.bounds.min, Math.min(this.bounds.max, a.x));
      const vx = (a.x - a.px) / Math.max(dt, 1e-3) + Math.cos(t * a.wf + a.wp) * a.wa * a.wf;
      const vy = (a.y - a.py) / Math.max(dt, 1e-3);
      a.vx += (vx - a.vx) * (1 - Math.exp(-dt * 10));
      a.vy += (vy - a.vy) * (1 - Math.exp(-dt * 10));
      const sp = Math.hypot(a.vx, a.vy);
      // 向き：進む向き（0 = 上）を8方向に。揺れでちらつかないよう少しだけ粘る
      if (sp > 4) {
        const ang = Math.atan2(a.vx, -a.vy);
        let d = Math.round(ang / (Math.PI / 4));
        d = ((d % 8) + 8) % 8;
        if (d !== a.dir) {
          const cur = a.dir * (Math.PI / 4);
          const diff = Math.abs(((ang - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (diff > Math.PI / 8 + 0.12) a.dir = d;
        }
      }
      a.walk += Math.max(sp, this.speed * 0.6) * dt;
      const f = Math.floor(a.walk / SWARM.stride) % 8;
      if (sw && a.y < sweepY && a.variant !== sw.next) {
        a.variant = sw.next;
        this.flashAnt(a, sw.glowColor ?? this.glowColor);
      }
      const V = S[a.variant] || S.base;
      a.spr.texture = V.color[a.dir][f];
      a.glow.texture = V.glow[a.dir][f];
      const px = Math.round(a.x), py = Math.round(a.y);
      a.spr.position.set(px, py);
      a.glow.position.set(px, py);
      a.spr.zIndex = py + (a.carpet ? -1000 : 0);
      let ga = (a.carpet ? 0.5 : 1) * (a.variant === this.variant ? this.glowScale : 1);
      if (this.pulse === 'beat') ga *= 0.12 + 0.88 * Math.pow(0.5 + 0.5 * Math.sin(t * 6 + a.wp * 0.3), 3);   // 自爆アリ：脈打つ
      else ga *= 0.82 + 0.18 * Math.sin(t * 2.2 + a.wp);
      a.glow.alpha = ga;
      if (a.flash) {
        a.flash.alpha -= dt * 2.6;
        a.flash.texture = V.white[a.dir][f];
        a.flash.position.set(px, py);
        if (a.flash.alpha <= 0) { a.flash.destroy(); a.flash = null; }
      }
    }
    if (sw && sw.t >= sw.dur) {
      this.variant = sw.next;
      if (sw.glowColor !== undefined) this.glowColor = sw.glowColor;
      this.pulse = sw.pulse;
      this.glowScale = sw.glowScale;
      this.sweep = null;
    }
    // 頭上の数字（カウンターが回るように増減する）
    this.shownCount += (this.count - this.shownCount) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.count - this.shownCount) < 0.5) this.shownCount = this.count;
    this.label.setText(formatCount(this.shownCount));
    this.label.position.set(Math.round(this.x), Math.round(this.y - this.ry * 1.08 - 24));
  }

  flashAnt(a, color) {
    if (a.flash) a.flash.destroy();
    const V = this.sprites.ants[a.variant];
    a.flash = new Sprite(V.white[a.dir][0]);
    a.flash.anchor.set(0.5);
    a.flash.tint = color;
    a.flash.alpha = a.carpet ? 0.6 : 1.1;
    this.flashLayer.addChild(a.flash);
  }

  /** 群れ全体を光らせる（変異しないときの演出） */
  flashAll(color) {
    for (const a of this.ants) this.flashAnt(a, color);
  }
}
