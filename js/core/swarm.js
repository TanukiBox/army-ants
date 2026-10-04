// アリの群れ：まとまって前へ進み、指の動きに少し遅れて流れるようについてくる。
// 表示するのは最大300匹。それより多い数は、群れを大きく・密にして、頭上の数字で表す。
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
};

/** 匹数 → 群れの半径（ドット） */
export function swarmRadius(n) {
  const m = Math.min(n, SWARM.maxFull);
  let R = Math.sqrt((m * SWARM.areaPerAnt) / Math.PI);
  if (n > SWARM.maxFull) R *= 1 + 0.3 * Math.log10(n / SWARM.maxFull);
  return R;
}

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
    this.count = 1;
    this.variant = 'base';
    this.glowColor = 0xff3a2a;
    this.pulse = 'steady';
    this.glowScale = 1;   // 光の強さ（種類ごと）
    this.x = 0;           // 群れの中心
    this.y = 0;
    this.targetX = 0;
    this.R = 0;
    this.time = 0;
    this.sweep = null;    // 変異の光が走っている途中なら { t, from, to, next }
    this.shownCount = 1;
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

  setCount(n) {
    this.count = n;
    const full = Math.min(n, SWARM.maxFull);
    const carpet = n > SWARM.maxFull ? Math.min(SWARM.maxCarpet, Math.round((n - SWARM.maxFull) * 0.065)) : 0;
    const want = full + carpet;
    while (this.ants.length > want) this.removeAnt(this.ants.pop());
    while (this.ants.length < want) this.ants.push(this.makeAnt(this.ants.length));
    this.R = swarmRadius(n);
    // 隊形：ひまわりの種の並び（中心から外へ均等に広がる）。横に少し長い楕円
    const rng = rngFor('formation');
    this.ants.forEach((a, i) => {
      const carpetAnt = i >= full;
      const k = carpetAnt ? i - full : i;
      const tot = carpetAnt ? carpet : full;
      // 真ん中は密に、ふちはまばらに（ふちのアリは1匹ずつの形が見える）
      const r = this.R * Math.pow((k + 0.5) / Math.max(tot, 1), 0.62) * (tot === 1 ? 0 : 1);
      const th = k * GOLDEN + (carpetAnt ? 1.3 : 0);
      a.ox = r * Math.cos(th) * 1.28 + (rng() - 0.5) * 3;
      a.oy = r * Math.sin(th) * 0.74 + (rng() - 0.5) * 3;
      a.carpet = carpetAnt;
      a.spr.tint = carpetAnt ? 0x8a8282 : 0xffffff;
      a.glow.alpha = carpetAnt ? 0.5 : 1;
      // 外側・後ろのアリほど遅れてついてくる（流れるように見える）
      const rel = this.R > 0 ? r / this.R : 0;
      a.k = SWARM.follow * (1.35 - 0.55 * rel - 0.25 * Math.max(0, a.oy / Math.max(this.R, 1))) * (0.85 + rng() * 0.3);
    });
  }

  makeAnt(i) {
    const rng = rngFor('ant' + i);
    const spr = new Sprite();
    spr.anchor.set(0.5);
    const glow = new Sprite();
    glow.anchor.set(0.5);
    this.layer.addChild(spr);
    this.glowLayer.addChildAt(glow, 0);
    return {
      spr, glow, flash: null,
      x: this.x, y: this.y, vx: 0, ox: 0, oy: 0, k: 6,
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

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.y -= SWARM.speed * dt;
    this.x += (this.targetX - this.x) * (1 - Math.exp(-dt * SWARM.follow));
    const S = this.sprites.ants;

    // 変異の光：前から後ろへ走る
    let sweepY = null;
    const sw = this.sweep;
    if (sw) {
      sw.t += dt;
      sweepY = this.y - this.R - 12 + Math.min(1, sw.t / sw.dur) * (this.R * 2 + 24);
    }

    for (const a of this.ants) {
      const hx = this.x + a.ox;
      const nx = a.x + (hx - a.x) * (1 - Math.exp(-dt * a.k));
      const wob = Math.sin(t * a.wf + a.wp) * a.wa;
      const vx = (nx - a.x) / Math.max(dt, 1e-3) + Math.cos(t * a.wf + a.wp) * a.wa * a.wf;
      a.vx += (vx - a.vx) * (1 - Math.exp(-dt * 10));
      a.x = nx;
      a.lunge = Math.max(0, a.lunge - dt * 40);
      a.y = this.y + a.oy + Math.cos(t * a.wf * 0.7 + a.wp) * a.wa * 0.8 - a.lunge;
      const vy = -SWARM.speed;
      // 向き：進む向き（0 = 上）を8方向に。揺れでちらつかないよう少しだけ粘る
      const ang = Math.atan2(a.vx, -vy);
      let d = Math.round(ang / (Math.PI / 4));
      d = ((d % 8) + 8) % 8;
      if (d !== a.dir) {
        const cur = a.dir * (Math.PI / 4);
        let diff = Math.abs(((ang - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff > Math.PI / 8 + 0.12) a.dir = d;
      }
      a.walk += Math.hypot(a.vx, vy) * dt;
      const f = Math.floor(a.walk / SWARM.stride) % 8;
      if (sw && a.y < sweepY && a.variant !== sw.next) {
        a.variant = sw.next;
        this.flashAnt(a, sw.glowColor ?? this.glowColor);
      }
      const V = S[a.variant] || S.base;
      a.spr.texture = V.color[a.dir][f];
      a.glow.texture = V.glow[a.dir][f];
      const px = Math.round(a.x + wob * 0.3), py = Math.round(a.y);
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
    this.label.position.set(Math.round(this.x), Math.round(this.y - this.R * 0.8 - 24));
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
}
