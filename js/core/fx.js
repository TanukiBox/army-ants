// 攻撃エフェクトと粒（パーティクル）。すべてドット単位で描くので、拡大してもくっきりしたまま。
//   under … 地面のすぐ上（焦げ跡・毒だまり）
//   over  … アリより上（土ぼこり・破片）
//   glow  … 光るもの（加算）：顎の閃き・毒弾・毒針・爆発
import { Container, Sprite, Texture } from '../../vendor/pixi.min.mjs';

export const C = {
  ember: 0xff8a24, red: 0xff3a2a, green: 0x5cff3a, greenDeep: 0x1c9e28,
  purple: 0xb85cff, purpleDeep: 0x6422c0, yellow: 0xffd420, orange: 0xff7a18,
  cyan: 0x36dcff, white: 0xfff6ec, acid: 0xe8d8a0, dirt: 0x3a2d23, dirtDark: 0x1a1411,
};

// ---------------------------------------------------------------------------
// その場で作る小さなドット絵（白で描いて、使うときに色をつける）
// ---------------------------------------------------------------------------
function pixTex(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = fn(x, y);
      if (!a) continue;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  g.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

const TEX = {};
export function textures() {
  if (TEX.dot) return TEX;
  TEX.dot = pixTex(1, 1, () => 1);
  TEX.dot2 = pixTex(2, 2, () => 1);
  TEX.ring = [];
  TEX.disc = [];
  for (let r = 1; r <= 34; r++) {
    const s = r * 2 + 1, th = r > 10 ? 2 : 1;
    TEX.ring[r] = pixTex(s, s, (x, y) => {
      const d = Math.hypot(x - r, y - r);
      return d <= r + 0.5 && d > r + 0.5 - th ? 1 : 0;
    });
    TEX.disc[r] = pixTex(s, s, (x, y) => (Math.hypot(x - r, y - r) <= r + 0.3 ? 1 : 0));
  }
  // 顎の閃き：上向きの三日月（真ん中が太く、両はしが細い）。広がりながら薄くなる5コマ
  TEX.snap = [0, 1, 2, 3, 4].map((k) => pixTex(31, 16, (x, y) => {
    const cx = 15, cy = 15, R = 9 + k * 1.4, th = Math.max(1.2, 4.6 - k * 0.9);
    const inA = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= R;
    const inB = Math.hypot(x + 0.5 - cx, y + 0.5 - (cy + th)) <= R;
    return inA && !inB && y < cy - 2 ? (k >= 3 ? 0.7 : 1) : 0;
  }));
  // 毒針の光の筋（上が先頭）
  TEX.lance = pixTex(3, 16, (x, y) => {
    const head = y < 3;
    if (x === 1) return head ? 1 : 1 - (y - 3) / 14;
    return head && y > 0 ? 0.8 : (y < 8 ? 0.35 * (1 - y / 8) : 0);
  });
  // 蟻酸のしずく（上が先頭の短い筋）
  TEX.streak = pixTex(2, 9, (x, y) => (y < 3 ? 1 : 1 - (y - 2) / 8));
  // 毒弾（緑の玉）
  TEX.glob = pixTex(5, 5, (x, y) => {
    const d = Math.hypot(x - 2, y - 2);
    return d <= 2.3 ? (d < 1.1 ? 1 : 0.85) : 0;
  });
  return TEX;
}

// ---------------------------------------------------------------------------
export class FX {
  constructor() {
    textures();
    this.under = new Container();
    this.over = new Container();
    this.glow = new Container();
    this.parts = [];
    this.anims = [];   // 動きを自分で決める物（弾・突撃するアリ・広がる輪など）
    this.timers = {};
    this.pools = new Map();   // 消えた粒の絵を、重ねる場所ごとに使い回す
  }

  /** 粒を1つ出す */
  spark(layer, x, y, o) {
    let pool = this.pools.get(layer);
    if (!pool) { pool = []; this.pools.set(layer, pool); }
    let s = pool.pop();
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      layer.addChild(s);
    }
    s.texture = o.tex || (o.size >= 2 ? TEX.dot2 : TEX.dot);
    s.tint = o.color ?? 0xffffff;
    s.alpha = o.alpha ?? 1;
    this.parts.push({
      s, layer, x, y, vx: o.vx || 0, vy: o.vy || 0, life: o.life || 0.4, max: o.life || 0.4,
      drag: o.drag ?? 3, a0: s.alpha, fade: o.fade ?? true,
    });
    s.position.set(Math.round(x), Math.round(y));
    return s;
  }

  burst(layer, x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? 0) + (o.spread ?? Math.PI * 2) * (Math.random() - 0.5);
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const col = Array.isArray(o.color) ? o.color[Math.floor(Math.random() * o.color.length)] : o.color;
      this.spark(layer, x, y, {
        ...o, color: col, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp,
        life: o.life[0] + Math.random() * (o.life[1] - o.life[0]),
      });
    }
  }

  /** 広がる輪 */
  ring(layer, x, y, r0, r1, dur, color, alpha = 1) {
    const s = new Sprite(TEX.ring[r0]);
    s.anchor.set(0.5);
    s.tint = color;
    layer.addChild(s);
    this.anims.push({ t: 0, update: (dt, a) => {
      a.t += dt;
      const p = Math.min(1, a.t / dur);
      const r = Math.max(1, Math.min(34, Math.round(r0 + (r1 - r0) * (1 - (1 - p) * (1 - p)))));
      s.texture = TEX.ring[r];
      s.alpha = alpha * (1 - p);
      s.position.set(Math.round(x), Math.round(y));
      if (p >= 1) { s.destroy(); return false; }
      return true;
    } });
  }

  /** ゆっくり消える円（焦げ跡・毒だまり・閃光） */
  blot(layer, x, y, r, color, alpha, dur) {
    const s = new Sprite(TEX.disc[Math.max(1, Math.min(34, r))]);
    s.anchor.set(0.5);
    s.tint = color;
    s.alpha = alpha;
    s.position.set(Math.round(x), Math.round(y));
    layer.addChild(s);
    this.anims.push({ t: 0, update: (dt, a) => {
      a.t += dt;
      s.alpha = alpha * Math.max(0, 1 - a.t / dur);
      if (a.t >= dur) { s.destroy(); return false; }
      return true;
    } });
    return s;
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.alpha = 0;   // 消さずに透明にして使い回す
        this.pools.get(p.layer).push(p.s);
        this.parts[i] = this.parts[this.parts.length - 1];
        this.parts.pop();
        continue;
      }
      const k = Math.exp(-dt * p.drag);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.s.position.set(Math.round(p.x), Math.round(p.y));
      if (p.fade) p.s.alpha = p.a0 * Math.min(1, (p.life / p.max) * 1.6);
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      if (!this.anims[i].update(dt, this.anims[i])) this.anims.splice(i, 1);
    }
  }

  clear() {
    this.parts = [];
    this.pools = new Map();
    for (const c of [this.under, this.over, this.glow]) c.removeChildren().forEach((s) => s.destroy());
    this.anims = [];
  }

  // =========================================================================
  // 攻撃エフェクト（指示書 3-5：顎で弾く・毒弾・毒針・爆発）
  // =========================================================================

  /** 自動で撃つ：kind ごとの間隔で攻撃を出す */
  auto(kind, lv, swarm, dt, view) {
    const every = { base: 0.45, armor: 0.45, mandible: 0.7, fire: 0.28, bullet: 0.95, bomb: 1.6 }[kind];
    this.timers[kind] = (this.timers[kind] ?? 0) + dt;
    if (this.timers[kind] < every) return;
    this.timers[kind] = 0;
    this.attack(kind, lv, swarm, view);
  }

  attack(kind, lv, swarm, view) {
    if (!swarm.ants.length) return;
    if (kind === 'mandible') this.snap(swarm, lv);
    else if (kind === 'fire') this.venom(swarm, lv);
    else if (kind === 'bullet') this.sting(swarm, lv);
    else if (kind === 'bomb') this.bomb(swarm, lv, view);
    else this.acid(swarm);
  }

  /** ふつうのアリ：蟻酸のしずくを前へ飛ばす */
  acid(swarm) {
    for (const a of swarm.randomAnts(2)) {
      this.spark(this.over, a.x, a.y - 8, { tex: TEX.dot2, color: C.acid, life: 3, fade: false, drag: 0 });
      const part = this.parts[this.parts.length - 1];
      const range = 90 + Math.random() * 60;
      let d = 0;
      this.anims.push({ update: (dt) => {
        const p = this.parts.includes(part) ? part : null;
        if (!p) return false;
        p.y -= 150 * dt;
        d += 150 * dt;
        if (d > range) {
          p.life = 0;
          this.burst(this.over, p.x, p.y, 5, { color: C.acid, speed: [15, 40], life: [0.15, 0.3], drag: 6 });
          return false;
        }
        return true;
      } });
    }
  }

  /** アギトアリ：前の列のアリが顎で弾く（三日月の閃き＋火花＋土ぼこり） */
  snap(swarm, lv) {
    const n = Math.min(swarm.ants.length, 3 + lv * 2);
    for (const a of swarm.frontAnts(n * 2).sort(() => Math.random() - 0.5).slice(0, n)) {
      a.lunge = 8;
      const x = a.x, y = a.y - 20 - lv * 3;
      const s = new Sprite(TEX.snap[0]);
      s.anchor.set(0.5, 1);
      s.tint = C.ember;
      this.glow.addChild(s);
      const core = new Sprite(TEX.snap[0]);
      core.anchor.set(0.5, 1);
      core.tint = C.white;
      this.glow.addChild(core);
      this.anims.push({ t: 0, update: (dt, an) => {
        an.t += dt;
        const k = Math.min(4, Math.floor(an.t / 0.04));
        s.texture = TEX.snap[k];
        core.texture = TEX.snap[Math.max(0, k - 1)];
        core.alpha = k < 2 ? 0.9 : 0;
        s.position.set(Math.round(x), Math.round(y - k));
        core.position.set(Math.round(x), Math.round(y - k + 1));
        if (an.t > 0.22) { s.destroy(); core.destroy(); return false; }
        return true;
      } });
      this.burst(this.glow, x, y - 8, 5 + lv, { color: [C.ember, C.white, C.yellow], speed: [50, 120], life: [0.12, 0.28], drag: 7, spread: 2.2 });
      this.burst(this.over, x, y - 4, 4, { color: [C.dirt, C.dirtDark], speed: [15, 45], life: [0.25, 0.5], drag: 5, spread: 2.0 });
    }
  }

  /** ヒアリ：緑に光る毒弾（尾を引いて飛び、当たると飛び散って毒だまりが残る） */
  venom(swarm, lv) {
    for (const a of swarm.randomAnts(1 + lv)) {
      const g = new Sprite(TEX.glob);
      g.anchor.set(0.5);
      g.tint = C.green;
      const core = new Sprite(TEX.dot);
      core.anchor.set(0.5);
      core.tint = C.white;
      this.glow.addChild(g, core);
      let x = a.x, y = a.y - 10, d = 0, trail = 0;
      const range = 95 + Math.random() * 70, ph = Math.random() * 6;
      this.anims.push({ t: 0, update: (dt, an) => {
        an.t += dt;
        y -= 125 * dt;
        d += 125 * dt;
        const wx = Math.round(Math.sin(an.t * 14 + ph) * 0.8);
        g.position.set(Math.round(x) + wx, Math.round(y));
        core.position.set(Math.round(x) + wx, Math.round(y));
        trail += dt;
        if (trail > 0.025) {
          trail = 0;
          this.spark(this.glow, x + wx, y + 2, { color: Math.random() < 0.5 ? C.green : C.greenDeep, life: 0.3, drag: 2, vy: 8 + Math.random() * 6, vx: (Math.random() - 0.5) * 8 });
        }
        if (d >= range) {
          g.destroy();
          core.destroy();
          this.burst(this.glow, x, y, 10 + lv * 2, { color: [C.green, C.white, C.greenDeep], speed: [25, 75], life: [0.2, 0.45], drag: 6 });
          this.blot(this.under, x, y + 2, 4 + lv, C.greenDeep, 0.85, 1.6);
          this.blot(this.glow, x, y + 2, 3 + lv, C.green, 0.35, 1.6);
          for (let i = 0; i < 6; i++) {   // ぶくぶく（毒が残って効き続ける）
            setTimeout(() => this.spark(this.glow, x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 5,
              { color: C.green, life: 0.5, drag: 1, vy: -12 }), 150 + i * 180);
          }
          return false;
        }
        return true;
      } });
    }
  }

  /** サシハリアリ：紫に光る毒針を1本、速く撃ち出す（当たると閃光と衝撃の輪） */
  sting(swarm, lv) {
    const a = swarm.frontAnts(Math.min(5, swarm.ants.length))[Math.floor(Math.random() * Math.min(5, swarm.ants.length))];
    if (!a) return;
    const l = new Sprite(TEX.lance);
    l.anchor.set(0.5, 0);
    l.tint = C.purple;
    const head = new Sprite(TEX.dot2);
    head.anchor.set(0.5);
    head.tint = C.white;
    this.glow.addChild(l, head);
    let x = a.x, y = a.y - 12, d = 0, ghost = 0;
    const range = 150 + Math.random() * 30, speed = 380;
    this.anims.push({ t: 0, update: (dt) => {
      y -= speed * dt;
      d += speed * dt;
      l.position.set(Math.round(x), Math.round(y));
      head.position.set(Math.round(x), Math.round(y) + 1);
      ghost += dt;
      if (ghost > 0.016) {   // 残像
        ghost = 0;
        const g = new Sprite(TEX.lance);
        g.anchor.set(0.5, 0);
        g.tint = C.purpleDeep;
        g.position.set(Math.round(x), Math.round(y) + 6);
        g.alpha = 0.6;
        this.glow.addChild(g);
        this.anims.push({ t: 0, update: (dt2, an) => {
          an.t += dt2;
          g.alpha = 0.6 * (1 - an.t / 0.14);
          if (an.t >= 0.14) { g.destroy(); return false; }
          return true;
        } });
      }
      if (d >= range) {
        l.destroy();
        head.destroy();
        this.blot(this.glow, x, y, 5 + lv, C.white, 1, 0.12);
        this.blot(this.glow, x, y, 9 + lv * 2, C.purple, 0.7, 0.22);
        this.ring(this.glow, x, y, 3, 18 + lv * 4, 0.32, C.purple, 1);
        this.ring(this.glow, x, y, 2, 10 + lv * 2, 0.22, C.white, 0.8);
        this.burst(this.glow, x, y, 12 + lv * 3, { color: [C.purple, C.white, C.purpleDeep], speed: [80, 170], life: [0.12, 0.3], drag: 8 });
        this.blot(this.under, x, y, 6 + lv, 0x1a0c24, 0.7, 1.4);
        return false;
      }
      return true;
    } });
  }

  /** 自爆アリ：前のアリが突撃し、ふくらんで光り、範囲爆発する（画面がゆれる） */
  bomb(swarm, lv, view) {
    const n = Math.min(swarm.ants.length, 1 + lv);
    for (const a of swarm.frontAnts(n * 3).sort(() => Math.random() - 0.5).slice(0, n)) {
      const V = swarm.sprites.ants[a.variant];
      const body = new Sprite(V.color[0][0]);
      body.anchor.set(0.5);
      const glow = new Sprite(V.glow[0][0]);
      glow.anchor.set(0.5);
      const flash = new Sprite(V.white[0][0]);
      flash.anchor.set(0.5);
      flash.tint = C.yellow;
      this.over.addChild(body);
      this.glow.addChild(glow, flash);
      let x = a.x, y = a.y - 4, walk = 0;
      const dur = 0.55 + Math.random() * 0.25, tx = (Math.random() - 0.5) * 30;
      this.anims.push({ t: 0, update: (dt, an) => {
        an.t += dt;
        y -= 105 * dt;
        x += tx * dt;
        walk += 105 * dt;
        const f = Math.floor(walk / 2.4) % 8;
        body.texture = V.color[0][f];
        glow.texture = V.glow[0][f];
        flash.texture = V.white[0][f];
        const p = an.t / dur;
        flash.alpha = (0.5 + 0.5 * Math.sin(an.t * (10 + p * 50))) * p;   // だんだん速く脈打つ
        for (const s of [body, glow, flash]) s.position.set(Math.round(x), Math.round(y));
        if (an.t >= dur) {
          body.destroy(); glow.destroy(); flash.destroy();
          this.explode(x, y, lv, view);
          return false;
        }
        return true;
      } });
    }
  }

  explode(x, y, lv, view) {
    const R = 14 + lv * 5;
    this.blot(this.glow, x, y, Math.round(R * 0.45), C.white, 1, 0.08);
    this.blot(this.glow, x, y, Math.round(R * 0.75), C.yellow, 0.55, 0.16);
    this.ring(this.glow, x, y, 4, Math.min(34, R + 12), 0.38, C.yellow, 1);
    this.ring(this.glow, x, y, 2, Math.min(34, R), 0.25, C.white, 0.9);
    this.burst(this.glow, x, y, 26 + lv * 6, { color: [C.yellow, C.orange, C.white, C.yellow], speed: [30, 120], life: [0.2, 0.55], drag: 5, size: 2 });
    this.burst(this.over, x, y, 14, { color: [C.dirt, C.dirtDark, 0x2a2019], speed: [40, 110], life: [0.35, 0.7], drag: 4, size: 2 });
    this.blot(this.under, x, y, Math.round(R * 0.6), 0x07050a, 0.75, 2.6);
    view?.shake(2 + lv);
  }
}
