// 1ステージ（参考動画に寄せた版）：少ない群れで前へ進み、撃って仲間と武器を手に入れながら、
// ステージのシロアリを全部倒して奥の巣を落とす。
//   ・群れのアリがそれぞれ前へ撃つ。弾1発で、的の数字がちょうど1ずつ減る
//   ・卵の山：上にアリが乗っている。撃ち割ると、そのアリが1匹ずつ走ってきて仲間になる（+1）
//   ・変異の繭：上に浮かぶアリの姿の能力に変わる（武器が変わる／Lv が上がる）
//   ・クモの糸に捕らわれた兵隊アリ：撃って助けると、群れの先頭で強い針を撃ち続ける
//   ・兵隊シロアリ：体力バー付き。列になって迫り、群れに着くと噛みついてアリを減らす
//   ・働きシロアリの大群：1発で1匹。触れると1匹ずつ相殺
//   ・＋の道（1枚ずつ+1）・−の看板（撃つと1ずつ上がる）
//   ・ミイデラゴミムシ：赤い円で予告してから熱いガスを吹く
//   ・上の「残り」：このステージのシロアリの数。0 にすると巣が落ちてクリア
import { Container, Sprite, Graphics } from '../../vendor/pixi.min.mjs';
import { CONFIG } from './config.js';
import { t, fmt } from './i18n.js';
import { sfx } from './audio.js';
import { textures, C as FXC } from '../core/fx.js';
import { PixelText, formatCount } from '../core/pixelfont.js';
import { applyMutation, previewMutation, variantName, swarmLook, MUT_COLOR } from './mutation.js';
import { addHoney, inv } from './meta.js';
import { getSave, save } from './save.js';

const HALF = CONFIG.track.width / 2;
const GOOD = { fill: 0x10306a, edge: 0x3a8cff, text: 0x7ab8ff };
const BAD = { fill: 0x6a1010, edge: 0xff3a2a, text: 0xff7a68 };
const GOLD = { fill: 0x6a4a08, edge: 0xffd420, text: 0xffe070 };

// 働きシロアリを横に区切って探す（弾・群れとの当たりを速く調べるため）
const BUCKET = 6;
const NB = Math.ceil((CONFIG.track.width + 120) / BUCKET);
const bucketOf = (x) => Math.max(0, Math.min(NB - 1, Math.floor((x + HALF + 60) / BUCKET)));

const anchorOf = (s, sheet) => s.anchor.set(sheet.anchor[0] / sheet.cell[0], sheet.anchor[1] / sheet.cell[1]);

/** 大群・兵隊シロアリの数（侵攻度で増える） */
export function foeCount(n, run) {
  return Math.max(1, Math.round(n * inv(run, 'enemyPer')));
}

// =============================================================================
// 働きシロアリの大群（1発で1匹。まっすぐ進む）
// =============================================================================
class Horde {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = ev.x;
    this.y = y;            // いちばん手前の列の位置。後ろの列ほど奥（上）に並ぶ
    const H = CONFIG.horde;
    const n = ev.exact ? ev.n : foeCount(ev.n, lane.G.run);   // exact：巣から出る分（数は巣で決め済み）
    this.n0 = n;
    this.speedMul = ev.speedMul ?? 1;
    const sp = H.spacing;
    const w = Math.max(sp, Math.min(ev.w ?? Math.sqrt(n) * sp * 1.3, CONFIG.track.width - 10));
    const cols = Math.max(1, Math.round(w / sp));
    const sheet = lane.S.props.termite_worker;
    this.units = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const inRow = Math.min(cols, n - r * cols);
      const s = new Sprite(sheet.anims.walk[0]);
      anchorOf(s, sheet);
      lane.swarm.layer.addChild(s);
      // 暗い地面で見えるよう、同じ絵をうすく光らせて重ねる
      const lit = new Sprite(sheet.anims.walk[0]);
      lit.anchor.copyFrom(s.anchor);
      lit.tint = H.litColor;
      lit.alpha = H.litAlpha;
      lane.glow.addChild(lit);
      this.units.push({
        s, lit, sheet,
        ox: (c - (inRow - 1) / 2) * sp + (Math.random() - 0.5) * 2,
        oy: -r * sp * 0.9 + (Math.random() - 0.5) * 2,
        x: this.x, y: this.y, hp: H.workerHp, ph: Math.random() * 6.28,
        poison: 0, poisoned: false, dead: false, horde: this,
      });
    }
    this.back = Math.min(...this.units.map((u) => u.oy));
    this.alive = n;
    this.lastDeath = -99;
    this.shot = 0;         // 撃って倒した数（ぶつかって相殺した数は数えない）
    this.walk = Math.random() * 10;
    this.update(0);
  }

  update(dt) {
    const H = CONFIG.horde;
    this.y += H.speed * this.speedMul * dt;
    this.walk += (H.speed * this.speedMul + this.lane.swarm.speed) * dt;
    for (const u of this.units) {
      if (u.dead) {
        // 倒れたシロアリは、その場に少し残って消える
        if (u.corpse > 0) {
          u.corpse -= dt;
          u.s.alpha = Math.max(0, Math.min(0.85, u.corpse / 0.5));
        }
        continue;
      }
      u.x = Math.max(-HALF + 3, Math.min(HALF - 3, this.x + u.ox + Math.sin(this.walk * 0.05 + u.ph) * H.wobble));
      u.y = this.y + u.oy;
      u.s.position.set(Math.round(u.x), Math.round(u.y));
      u.s.zIndex = u.y;
      const fr = u.sheet.anims.walk;
      u.s.texture = u.lit.texture = fr[Math.floor(this.walk / 2.2 + u.ph) % fr.length];
      u.lit.position.copyFrom(u.s.position);
      if (u.poisoned) {
        u.s.tint = Math.sin(this.lane.time * 30 + u.ph) > 0 ? 0x8cff6a : 0x4cb03a;
        u.poison -= dt;
        if (u.poison <= 0) this.lane.killUnit(u, 'poison');
      }
    }
  }

  /** 全部倒れて、倒れた姿も消えた */
  get done() { return this.alive <= 0 && this.lane.time - this.lastDeath > CONFIG.horde.corpse; }

  /** 全部倒れた（倒れた姿はまだ残っているかも） */
  get wiped() { return this.alive <= 0; }

  destroy() {
    for (const u of this.units) { u.s.destroy(); u.lit.destroy(); }
    this.units = [];
  }
}

// =============================================================================
// 兵隊シロアリ（体力バー付き。群れに近づくと寄ってきて、着くと噛みつく）
// =============================================================================
class Soldier {
  constructor(lane, x, y, hp, speedMul = 1) {
    this.lane = lane;
    this.x = x;
    this.y = y;
    this.speedMul = speedMul;
    this.hp = this.hp0 = hp;
    this.r = CONFIG.soldier.radius;
    this.sheet = lane.S.props.termite_soldier;
    this.s = new Sprite(this.sheet.anims.walk[0]);
    anchorOf(this.s, this.sheet);
    lane.swarm.layer.addChild(this.s);
    this.lit = new Sprite(this.sheet.anims.walk[0]);
    this.lit.anchor.copyFrom(this.s.anchor);
    this.lit.tint = CONFIG.soldier.litColor;
    this.lit.alpha = CONFIG.soldier.litAlpha;
    lane.glow.addChild(this.lit);
    this.bar = new Graphics();
    lane.top.addChild(this.bar);
    this.engaged = false;
    this.ox = 0;
    this.biteT = 0.25;
    this.walk = Math.random() * 10;
    this.ph = Math.random() * 6;
    this.poison = 0;
    this.hurtT = 0;
    this.dead = false;
    this.corpse = 0;
  }

  damage(d, kind) {
    if (this.dead) return;
    this.hp -= d;
    this.hurtT = 0.07;
    if (kind === 'venom') this.poison += CONFIG.arms.fire.dot[0] * this.lane.G.run.mods.poisonMul;
    if (this.hp <= 0) this.die('shot');
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.corpse = CONFIG.horde.corpse;
    const lane = this.lane, fx = lane.fx;
    fx.burst(fx.glow, this.x, this.y - 4, 6, { color: [0xfff4e0, 0xffe0b0], speed: [20, 60], life: [0.15, 0.3], drag: 6 });
    fx.burst(fx.over, this.x, this.y - 2, 9, { color: [0xd8c0a0, 0x8a7048, 0x6a5538, 0x3a2a20], speed: [30, 90], life: [0.25, 0.55], drag: 5, size: 2 });
    this.s.tint = 0x5a4836;
    this.lit.alpha = 0;
    this.bar.clear();
    lane.foeDown(1);
    if (cause !== 'flee') lane.countKill(this.x, this.y, true);
  }

  update(dt) {
    const lane = this.lane, sw = lane.swarm, S = CONFIG.soldier;
    if (this.dead) {
      this.corpse -= dt;
      this.s.alpha = Math.max(0, Math.min(0.85, this.corpse / 0.5));
      return;
    }
    if (this.poison > 0) {
      const p = Math.min(this.poison, dt * 2);
      this.poison -= p;
      this.hp -= p;
      if (this.hp <= 0) { this.die('shot'); return; }
    }
    if (!this.engaged) {
      this.y += S.speed * this.speedMul * dt;
      // 近づくと、群れのほうへ寄ってくる
      const dy = sw.y - this.y;
      if (dy > 0 && dy < S.homeRange && sw.count > 0) {
        const want = sw.x - this.x, step = S.homeSpeed * dt;
        this.x += Math.max(-step, Math.min(step, want));
      }
      const ex = (this.x - sw.x) / (sw.rx + this.r), ey = (this.y - sw.y) / (sw.ry + this.r);
      if (sw.count > 0 && ex * ex + ey * ey < 1) {
        if (lane.feverT > 0) { this.die('trample'); return; }   // 大暴れ中は踏みつぶす
        this.engaged = true;
        this.ox = Math.max(-sw.rx, Math.min(sw.rx, this.x - sw.x));
        sfx.hurt();
      }
    } else {
      // 群れの先頭に食らいついて噛む
      if (lane.feverT > 0) { this.die('trample'); return; }
      if (sw.count <= 0) { this.engaged = false; return; }
      this.x += (sw.x + this.ox - this.x) * Math.min(1, dt * 8);
      this.y += (sw.y - sw.ry * 0.6 - this.y) * Math.min(1, dt * 8);
      this.biteT -= dt;
      if (this.biteT <= 0) {
        this.biteT = S.biteEvery;
        const run = lane.G.run;
        const chance = (1 - CONFIG.armor.reduce[run.armor]) * run.mods.dmgTaken * inv(run, 'hitPer');
        if (Math.random() < chance) lane.loseAnts(1, { at: { x: this.x, y: this.y }, why: 'bite' });
        lane.fx.burst(lane.fx.glow, this.x, this.y + 4, 4, { color: [0xff5a3a, 0xffffff], speed: [20, 50], life: [0.1, 0.2], drag: 6 });
        sfx.snap();
      }
    }
    this.walk += (S.speed + sw.speed) * dt;
    const fr = this.sheet.anims.walk;
    const px = Math.round(this.x), py = Math.round(this.y);
    this.s.texture = this.lit.texture = fr[Math.floor(this.walk / 2 + this.ph) % fr.length];
    this.s.position.set(px, py);
    this.lit.position.set(px, py);
    this.s.zIndex = py;
    this.s.tint = this.hurtT > 0 ? 0xffc0b0 : this.poison > 0 ? 0xa8ff90 : 0xffffff;
    this.hurtT -= dt;
    // 体力バー
    const b = this.bar, w = 14;
    b.clear();
    b.rect(px - w / 2 - 1, py - 21, w + 2, 4).fill({ color: 0x0a0406 });
    b.rect(px - w / 2, py - 20, Math.max(0, Math.round(w * this.hp / this.hp0)), 2).fill({ color: 0xff4a30 });
  }

  destroy() {
    this.s.destroy();
    this.lit.destroy();
    this.bar.destroy();
  }
}

// =============================================================================
// 卵の山（上にアリが乗っている。撃ち割ると、そのアリが走ってきて仲間になる）
// =============================================================================
class Egg {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = ev.x;
    this.y = y;
    this.hp = this.hp0 = ev.hp;
    this.reward = Math.max(1, Math.round(ev.n * lane.G.run.mods.eggMul));   // 産卵の法則で増える
    this.r = CONFIG.egg.radius;
    this.state = 'alive';
    this.g = new Graphics();
    this.g.zIndex = y;
    lane.swarm.layer.addChild(this.g);
    this.gl = new Graphics();
    lane.glow.addChild(this.gl);
    // 卵の並び
    const k = 9;
    this.eggs = [];
    for (let i = 0; i < k; i++) {
      const a = i * 2.39996, rr = 11 * Math.sqrt((i + 0.5) / k);
      this.eggs.push({ x: Math.round(Math.cos(a) * rr * 1.35), y: Math.round(Math.sin(a) * rr * 0.55) - 5 });
    }
    this.eggs.sort((p, q) => p.y - q.y);
    // 上に乗っているアリ（まだ仲間ではないので色はうすい）
    const V = lane.S.ants.base;
    this.riders = [];
    const show = Math.min(this.reward, CONFIG.egg.showMax);
    for (let i = 0; i < show; i++) {
      const s = new Sprite(V.color[4][0]);
      s.anchor.set(0.5);
      s.tint = 0xd8c8b0;
      lane.top.addChild(s);
      const row = i < 3 ? 0 : 1, col = row === 0 ? i : i - 3, inRow = row === 0 ? Math.min(3, show) : show - 3;
      this.riders.push({ s, dx: (col - (inRow - 1) / 2) * 9, dy: -16 - row * 7, ph: Math.random() * 6 });
    }
    this.hpLabel = new PixelText(String(this.hp), 2);
    lane.top.addChild(this.hpLabel);
    this.rewardLabel = new PixelText('+' + this.reward, 1);
    this.rewardLabel.tint = 0xb8ffb0;
    lane.top.addChild(this.rewardLabel);
    this.hurt = 0;
    this.kick = 0;
    this.t = Math.random() * 6;
    this.draw();
  }

  draw() {
    const g = this.g, x = this.x, y = Math.round(this.y);
    g.clear();
    g.ellipse(x, y + 2, 17, 6).fill({ color: 0x000000, alpha: 0.4 });
    const show = Math.max(1, Math.ceil(this.eggs.length * this.hp / this.hp0));
    const white = this.hurt > 0;
    for (let i = 0; i < this.eggs.length; i++) {
      const e = this.eggs[i];
      const ex = x + e.x, ey = y + e.y;
      if (i >= show) {   // 割れた卵：殻だけ
        g.ellipse(ex, ey + 2, 3, 2).fill({ color: 0x6a5a40 });
        continue;
      }
      g.ellipse(ex, ey, 4, 5.5).fill({ color: white ? 0xffffff : 0xe6d8b4 }).stroke({ width: 1, color: 0x2a2018 });
      g.ellipse(ex + 1, ey + 2, 2, 3).fill({ color: white ? 0xffffff : 0xc8b890 });
      g.rect(ex - 2, ey - 3, 1, 2).fill({ color: 0xfffaf0 });
    }
    this.hpLabel.setText(String(Math.max(1, Math.ceil(this.hp))));
    this.hpLabel.position.set(x, y + 6);
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d;
    this.hurt = 0.05;
    this.kick = 0.08;
    sfx.cocoonHit();
    if (Math.random() < 0.5) {
      const fx = this.lane.fx;
      fx.burst(fx.over, this.x + (Math.random() - 0.5) * 14, this.y - 6, 2, { color: [0xfffaf0, 0xe6d8b4], speed: [20, 60], life: [0.15, 0.3], drag: 5 });
    }
    if (this.hp <= 0) this.hatch();
    else this.draw();
  }

  hatch() {
    this.state = 'gone';
    const lane = this.lane, fx = lane.fx;
    fx.burst(fx.over, this.x, this.y - 4, 24, { color: [0xe6d8b4, 0xfffaf0, 0xb8a888], speed: [40, 130], life: [0.3, 0.7], drag: 4, size: 2 });
    fx.burst(fx.glow, this.x, this.y - 6, 14, { color: [0xffe080, 0xffffff], speed: [30, 90], life: [0.2, 0.45], drag: 5, size: 2 });
    fx.ring(fx.glow, this.x, this.y - 4, 3, 24, 0.35, 0xffe080, 0.9);
    lane.G.view.shake(CONFIG.feel.shakeSmall);
    sfx.hatch();
    // 乗っていたアリが1匹ずつ走ってきて仲間になる（乗せきれない分は卵から出てくる）
    for (let i = 0; i < this.reward; i++) {
      const r = this.riders[i];
      const x = r ? this.x + r.dx : this.x + (Math.random() - 0.5) * 20;
      const y = r ? this.y + r.dy : this.y - 4;
      lane.addRunner(x, y, i * CONFIG.egg.runnerGap);
    }
    this.remove();
  }

  update(dt) {
    if (this.state === 'passed') {
      this.fade -= dt;
      const a = Math.max(0, this.fade * 2);
      for (const s of [this.g, this.hpLabel, this.rewardLabel]) s.alpha = a;
      for (const r of this.riders) r.s.alpha = a;
      if (this.fade <= 0) this.remove();
      return;
    }
    if (this.state !== 'alive') return;
    this.t += dt;
    if (this.hurt > 0) { this.hurt -= dt; if (this.hurt <= 0) this.draw(); }
    // 当たるとゆれる・数字がはねる
    this.kick -= dt;
    const kx = this.kick > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.g.position.x = kx;
    this.hpLabel.scale.set(this.kick > 0.04 ? 3 : 2);
    const y = Math.round(this.y);
    for (const r of this.riders) {
      r.s.position.set(Math.round(this.x + r.dx + kx), y + r.dy + Math.round(Math.sin(this.t * 3 + r.ph)));
      r.s.zIndex = y;
    }
    this.rewardLabel.position.set(this.x, y - 30);
    const gl = this.gl;
    gl.clear();
    gl.ellipse(this.x, y - 5, 18, 10).fill({ color: 0xfff0b0, alpha: 0.1 + 0.05 * Math.sin(this.t * 3) });
    const sw = this.lane.swarm;
    if (sw.y < this.y + 2) {   // 割れないまま追いついた → 素通り
      this.state = 'passed';
      this.fade = 0.4;
    }
  }

  remove() {
    if (this.state === 'dead') return;
    for (const s of [this.g, this.gl, this.hpLabel, this.rewardLabel]) s.destroy();
    for (const r of this.riders) r.s.destroy();
    this.riders = [];
    this.state = 'dead';
  }
}

// =============================================================================
// 変異の繭（割ると変異する。上に中のアリの姿と、割るとどうなるか）
// =============================================================================
class Cocoon {
  constructor(lane, ev, y) {
    this.f = lane;
    this.x = ev.x;
    this.y = y;
    this.mut = ev.mut;
    this.hp = this.hp0 = Math.max(4, Math.ceil(ev.hp * lane.G.run.mods.cocoonHp));
    this.r = CONFIG.cocoon.radius;
    this.state = 'alive';
    const sh = lane.S.props.cocoon;
    this.sheet = sh;
    this.spr = new Sprite(sh.anims.stage[0]);
    anchorOf(this.spr, sh);
    this.spr.position.set(this.x, Math.round(y));
    this.spr.zIndex = y;
    lane.swarm.layer.addChild(this.spr);
    this.light = new Sprite(sh.glow?.stage[0] ?? sh.anims.stage[0]);
    this.light.anchor.copyFrom(this.spr.anchor);
    this.light.position.copyFrom(this.spr.position);
    this.light.tint = MUT_COLOR[this.mut];
    lane.glow.addChild(this.light);
    // 中にいるアリの姿と、その下の光る輪（武器が乗っている台のように）
    const vn = this.mut === 'armor' ? 'armor1' : `${this.mut}1`;
    const V = lane.S.ants[vn];
    this.ring = new Graphics();
    lane.glow.addChild(this.ring);
    this.icon = new Sprite(V.color[4][0]);
    this.icon.anchor.set(0.5);
    this.icon.position.set(this.x, Math.round(y) + CONFIG.cocoon.iconY);
    this.iconGlow = new Sprite(V.glow[4][0]);
    this.iconGlow.anchor.set(0.5);
    this.iconGlow.position.copyFrom(this.icon.position);
    lane.top.addChild(this.icon);
    lane.glow.addChild(this.iconGlow);
    this.label = new PixelText(String(this.hp), 2);
    this.label.position.set(this.x, Math.round(y) + CONFIG.cocoon.hpY);
    lane.top.addChild(this.label);
    this.el = document.createElement('div');
    this.el.className = 'c-lbl';
    this.el.style.setProperty('--c', '#' + MUT_COLOR[this.mut].toString(16).padStart(6, '0'));
    document.getElementById('field-ui').appendChild(this.el);
    this.elKey = '';
    this.t = Math.random() * 6;
    this.place();
  }

  place() {
    const run = this.f.G.run;
    const p = previewMutation(run, this.mut);
    const key = p.how + p.lv;
    if (key !== this.elKey) {
      this.elKey = key;
      this.el.innerHTML = `<b>${t('mut_' + this.mut)}</b><span class="${p.how}">${t('cocoon_' + p.how, { n: p.lv })}</span>`;
    }
    const G = this.f.G;
    const q = G.worldToCss(this.x, this.y + CONFIG.cocoon.labelY);
    const m = 46;
    this.el.style.left = Math.max(m, Math.min(G.view.cssW - m, q.x)) + 'px';
    this.el.style.top = q.y + 'px';
    if (this.state === 'alive') this.el.style.opacity = String(Math.max(0, Math.min(1, (q.y - 70) / 50)));   // 上の表示と重ならないように
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d * this.f.G.run.mods.cocoonDmg;
    this.kick = 0.08;
    sfx.cocoonHit();
    if (Math.random() < 0.4) {
      const fx = this.f.fx;
      fx.burst(fx.glow, this.x + (Math.random() - 0.5) * 14, this.y - 12, 2, { color: [MUT_COLOR[this.mut], 0xffffff], speed: [20, 60], life: [0.12, 0.25], drag: 5 });
    }
    if (this.hp <= 0) this.break();
    else {
      const r = this.hp / this.hp0;
      const st = r > 0.66 ? 0 : r > 0.33 ? 1 : r > 0.1 ? 2 : 3;
      this.spr.texture = this.sheet.anims.stage[st];
      if (this.sheet.glow) this.light.texture = this.sheet.glow.stage[st];
      this.label.setText(String(Math.ceil(this.hp)));
    }
  }

  break() {
    this.state = 'broken';
    const fx = this.f.fx;
    const col = MUT_COLOR[this.mut];
    fx.burst(fx.glow, this.x, this.y - 6, 24, { color: [col, 0xffffff, col], speed: [30, 110], life: [0.3, 0.7], drag: 4, size: 2 });
    fx.burst(fx.over, this.x, this.y - 4, 12, { color: [0x52525e, 0x383842, 0x70707e], speed: [20, 70], life: [0.4, 0.8], drag: 4, size: 2 });
    fx.ring(fx.glow, this.x, this.y - 6, 3, 26, 0.35, col, 1);
    fx.ring(fx.glow, this.x, this.y - 6, 2, 34, 0.5, 0xffffff, 0.8);
    this.f.G.hitstop();
    this.f.G.view.shake(2.5);
    sfx.cocoonBreak();
    this.f.honey(CONFIG.honey.cocoon, this.x, this.y - 10);
    // 中のアリが光りながら群れへ飛び込む
    const lane = this.f, sw = lane.swarm, mcol = MUT_COLOR[this.mut];
    const fly = new Sprite(this.icon.texture);
    fly.anchor.set(0.5);
    fly.position.copyFrom(this.icon.position);
    lane.top.addChild(fly);
    const x0 = fly.x, y0 = fly.y;
    let tt = 0;
    lane.fx.anims.push({ update: (dt) => {
      tt += dt;
      const p = Math.min(1, tt / 0.32), e = p * p;
      fly.position.set(Math.round(x0 + (sw.x - x0) * e), Math.round(y0 + (sw.y - y0) * e - Math.sin(p * Math.PI) * 20));
      if (p < 1) return true;
      fly.destroy();
      lane.fx.ring(lane.fx.glow, sw.x, sw.y, 4, 30, 0.45, mcol, 1);
      lane.fx.burst(lane.fx.glow, sw.x, sw.y, 20, { color: [mcol, 0xffffff], speed: [40, 120], life: [0.2, 0.5], drag: 4, size: 2 });
      return false;
    } });
    this.f.mutate(this.mut, this.x, this.y);
    this.remove();
  }

  update(dt) {
    if (this.state === 'passed') {
      this.fade -= dt;
      for (const s of [this.spr, this.light, this.icon, this.iconGlow, this.label, this.ring]) s.alpha = Math.max(0, this.fade * 2);
      this.el.style.opacity = String(Math.max(0, this.fade * 2));
      this.place();
      if (this.fade <= 0) this.remove();
      return;
    }
    if (this.state !== 'alive') return;
    this.t += dt;
    this.light.alpha = 0.55 + 0.45 * Math.sin(this.t * 4) ** 2;
    this.iconGlow.alpha = this.light.alpha;
    this.kick = (this.kick || 0) - dt;
    const kx = this.kick > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.spr.position.x = this.light.position.x = this.x + kx;
    this.label.scale.set(this.kick > 0.04 ? 3 : 2);
    // 中のアリがふわふわ浮く
    const bob = Math.round(Math.sin(this.t * 2.4) * 2);
    this.icon.position.y = Math.round(this.y) + CONFIG.cocoon.iconY + bob;
    this.iconGlow.position.y = this.icon.position.y;
    this.ring.clear();
    this.ring.ellipse(this.x, Math.round(this.y) + CONFIG.cocoon.iconY + 9, 9, 3).stroke({ width: 1, color: 0xffd040, alpha: 0.6 + 0.4 * Math.sin(this.t * 4) });
    this.place();
    if (this.f.swarm.y < this.y + 4) {
      this.state = 'passed';
      this.f.G.popup(this.x, this.y - 30, t('passed'), 'passed');
      this.fade = 0.5;
    }
  }

  remove() {
    if (this.state === 'gone') return;
    for (const s of [this.spr, this.light, this.icon, this.iconGlow, this.label, this.ring]) s.destroy();
    this.el.remove();
    this.state = 'gone';
  }
}

// =============================================================================
// クモの糸に捕らわれた兵隊アリ（撃って助けると、群れの先頭で戦う仲間になる）
// =============================================================================
class Cage {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = ev.x;
    this.y = y;
    this.hp = this.hp0 = ev.hp;
    this.r = CONFIG.cage.radius;
    this.state = 'alive';
    const V = lane.S.ants[CONFIG.hero.variant];
    this.ant = new Sprite(V.color[4][0]);
    this.ant.anchor.set(0.5);
    this.ant.scale.set(2);
    this.ant.tint = 0x9a90a0;
    this.ant.position.set(this.x, Math.round(y) - 14);
    this.ant.zIndex = y;
    lane.swarm.layer.addChild(this.ant);
    this.web = new Graphics();
    this.web.zIndex = y + 1;
    lane.swarm.layer.addChild(this.web);
    this.label = new PixelText(String(this.hp), 2);
    this.label.tint = 0xe8e0ff;
    lane.top.addChild(this.label);
    this.kick = 0;
    this.t = 0;
    this.drawWeb();
  }

  drawWeb() {
    const g = this.web, x = this.x, y = Math.round(this.y) - 14;
    const k = this.hp / this.hp0;
    g.clear();
    g.ellipse(x, y + 16, 18, 5).fill({ color: 0x000000, alpha: 0.35 });
    const strands = Math.max(2, Math.round(10 * k));
    for (let i = 0; i < strands; i++) {
      const a = (i / 10) * Math.PI;
      g.moveTo(x + Math.cos(a) * 17, y + Math.sin(a) * 18 - 2).lineTo(x - Math.cos(a) * 17, y - Math.sin(a) * 18 + 2);
    }
    g.stroke({ width: 1, color: 0xe8e8f0, alpha: 0.75 });
    g.ellipse(x, y, 16 * (0.6 + 0.4 * k), 18 * (0.6 + 0.4 * k)).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    this.label.setText(String(Math.max(1, Math.ceil(this.hp))));
    this.label.position.set(x, y + 26);
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d;
    this.kick = 0.06;
    sfx.cocoonHit();
    if (Math.random() < 0.4) {
      const fx = this.lane.fx;
      fx.burst(fx.over, this.x + (Math.random() - 0.5) * 24, this.y - 16, 2, { color: [0xffffff, 0xd8d8e8], speed: [20, 60], life: [0.2, 0.4], drag: 4 });
    }
    if (this.hp <= 0) this.free();
    else this.drawWeb();
  }

  free() {
    this.state = 'gone';
    const lane = this.lane, fx = lane.fx;
    fx.burst(fx.over, this.x, this.y - 14, 30, { color: [0xffffff, 0xe0e0f0, 0xb8b8c8], speed: [40, 140], life: [0.3, 0.8], drag: 3, size: 2 });
    fx.ring(fx.glow, this.x, this.y - 14, 4, 34, 0.5, 0xffe080, 1);
    lane.G.hitstop();
    lane.G.view.shake(2.5);
    sfx.cocoonBreak();
    lane.addHero(this.x, this.y - 14);
    this.remove();
  }

  update(dt) {
    if (this.state === 'passed') {
      this.fade -= dt;
      for (const s of [this.ant, this.web, this.label]) s.alpha = Math.max(0, this.fade * 2);
      if (this.fade <= 0) this.remove();
      return;
    }
    if (this.state !== 'alive') return;
    this.t += dt;
    this.kick -= dt;
    const kx = this.kick > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.web.position.x = kx;
    this.ant.position.x = this.x + kx;
    this.label.scale.set(this.kick > 0.03 ? 3 : 2);
    if (this.lane.swarm.y < this.y + 2) {
      this.state = 'passed';
      this.fade = 0.4;
    }
  }

  remove() {
    if (this.state === 'dead') return;
    for (const s of [this.ant, this.web, this.label]) s.destroy();
    this.state = 'dead';
  }
}

// =============================================================================
// 板（−の看板・＋の道の1枚・金の×2ゲート）。群れが触れると効く
// =============================================================================
class Panel {
  /** kind: 'board'（撃つと上がる）/ 'plus' / 'gold'（×2） */
  constructor(lane, kind, x, y, w, v) {
    this.lane = lane;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = kind === 'plus' ? 10 : 14;
    this.v = this.v0 = v;
    this.hits = 0;
    this.cap = kind === 'board' ? Math.max(1, Math.round(Math.abs(v) * CONFIG.board.capRatio)) : v;
    this.used = false;
    this.fade = 0;
    this.bump = 0;
    this.g = new Graphics();
    lane.top.addChild(this.g);
    this.gl = new Graphics();
    lane.glow.addChild(this.gl);
    this.label = new PixelText('', kind === 'plus' ? 1 : 2);
    lane.top.addChild(this.label);
    this.draw();
  }

  get colors() {
    if (this.kind === 'gold') return GOLD;
    return this.v > 0 ? GOOD : BAD;
  }

  text() {
    if (this.kind === 'gold') return '×2';
    return (this.v >= 0 ? '+' : '-') + formatCount(Math.abs(this.v));
  }

  draw() {
    const c = this.colors, g = this.g, gl = this.gl;
    const x0 = Math.round(this.x - this.w / 2), y0 = Math.round(this.y - this.h / 2);
    g.clear();
    gl.clear();
    g.rect(x0, y0, this.w, this.h).fill({ color: c.fill, alpha: this.kind === 'gold' ? 0.55 : 0.45 });
    g.rect(x0 - 1, y0 - 3, 2, this.h + 5).fill({ color: 0x0a0608 });
    g.rect(x0 + this.w - 1, y0 - 3, 2, this.h + 5).fill({ color: 0x0a0608 });
    gl.rect(x0, y0, this.w, 1).fill({ color: c.edge, alpha: 0.95 });
    gl.rect(x0, y0 + this.h - 1, this.w, 1).fill({ color: c.edge, alpha: 0.5 });
    if (this.kind === 'gold') gl.rect(x0, y0, this.w, this.h).fill({ color: c.edge, alpha: 0.12 });
    const base = this.kind === 'plus' ? 1 : 2;
    this.label.pxScale = this.bump > 0 ? base + 1 : base;
    this.label.setText(this.text());
    this.label.scale.set(this.label.pxScale);
    this.label.tint = c.text;
    this.label.position.set(Math.round(this.x), Math.round(this.y + this.h / 2) - 2);
  }

  /** −の看板を撃った：数字が1ずつ上がる */
  hit(power = 1) {
    if (this.kind !== 'board' || this.used || this.v >= this.cap) return false;
    this.hits += power;
    if (this.hits >= CONFIG.board.hitsPerStep) {
      this.hits = 0;
      this.v = Math.min(this.cap, this.v + 1);
      if (this.v === 0) this.v = 1;
      this.bump = 0.08;
      this.draw();
    }
    return true;
  }

  /** 群れが触れたか */
  touching(sw) {
    if (sw.count <= 0) return false;
    return Math.abs(sw.x - this.x) < this.w / 2 + sw.rx * 0.85 && Math.abs(sw.y - this.y) < sw.ry * 0.85 + this.h / 2;
  }

  update(dt) {
    if (this.used) {
      this.fade -= dt;
      for (const s of [this.g, this.gl, this.label]) s.alpha = Math.max(0, this.fade * 2.5);
      return;
    }
    if (this.bump > 0) { this.bump -= dt; if (this.bump <= 0) this.draw(); }
    const sw = this.lane.swarm;
    if (this.touching(sw)) {
      this.used = true;
      this.fade = 0.4;
      this.lane.applyPanel(this);
    }
  }

  get gone() { return this.used && this.fade <= 0; }

  destroy() {
    this.g.destroy();
    this.gl.destroy();
    this.label.destroy();
  }
}

// =============================================================================
// ミイデラゴミムシ（赤い円で予告してから、熱いガスを吹く）
// =============================================================================
class Beetle {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = ev.x;
    this.y = y;
    this.hp = this.hp0 = ev.hp;
    this.r = CONFIG.beetle.radius;
    this.poison = 0;
    this.sheet = lane.S.props.beetle;
    const sh = this.sheet;
    this.spr = new Sprite(sh.anims.walk[0]);
    anchorOf(this.spr, sh);
    lane.swarm.layer.addChild(this.spr);
    this.gl = new Sprite(sh.glow?.walk[0] ?? sh.anims.walk[0]);
    this.gl.anchor.copyFrom(this.spr.anchor);
    this.gl.visible = !!sh.glow;
    lane.glow.addChild(this.gl);
    this.bar = new Graphics();
    lane.top.addChild(this.bar);
    this.cool = 0.6 + Math.random() * 0.6;
    this.shootT = 0;
    this.walk = 0;
    this.hurtT = 0;
    this.counted = false;
  }

  get dead() { return this.hp <= 0; }

  damage(d) {
    if (this.dead) return;
    this.hp -= d;
    this.hurtT = 0.08;
    sfx.hit();
    if (this.hp <= 0) this.die();
  }

  die() {
    this.hp = 0;
    const lane = this.lane;
    lane.honey(CONFIG.honey.beetle, this.x, this.y);
    if (!this.counted) { this.counted = true; lane.foeDown(1); lane.countKill(this.x, this.y, true); }
    const fx = lane.fx;
    fx.burst(fx.glow, this.x, this.y, 18, { color: [FXC.ember, FXC.orange, 0xffffff], speed: [30, 100], life: [0.2, 0.5], drag: 5, size: 2 });
    fx.burst(fx.over, this.x, this.y, 14, { color: [0x36220c, 0x0f090b, 0x553410], speed: [30, 90], life: [0.3, 0.7], drag: 4, size: 2 });
    fx.blot(fx.under, this.x, this.y + 2, 8, 0x07050a, 0.6, 2);
    sfx.explode(false);
  }

  update(dt) {
    const lane = this.lane, sw = lane.swarm, Gs = CONFIG.gas;
    this.y += 6 * dt;
    if (this.poison > 0) {
      const p = Math.min(this.poison, dt * 3);
      this.poison -= p;
      this.damage(p);
      if (this.dead) return;
    }
    // 群れに踏まれた
    const dx = (this.x - sw.x) / (sw.rx + this.r), dy = (this.y - sw.y) / (sw.ry + this.r);
    if (sw.count > 0 && dx * dx + dy * dy < 1) {
      lane.loseAnts(Gs.contact, { at: { x: this.x, y: this.y }, armor: true, why: 'beetle' });
      sfx.hurt();
      this.die();
      return;
    }
    this.cool -= dt;
    const near = sw.y - this.y < Gs.range && this.y < sw.y - sw.ry - 10;
    if (near && this.cool <= 0 && sw.count > 0 && lane.state === 'run') {
      this.cool = Gs.every;
      this.shootT = 0.45;
      // 群れが着くころの場所を狙う（前に進むぶん先回り）
      const lead = sw.speed * Gs.warn;
      lane.addDanger(sw.x + (sw.targetX - sw.x) * 0.5, sw.y - lead, Gs.radius, Gs.warn, this);
    }
    this.walk += dt;
    const sh = this.sheet;
    let k, frame;
    if (this.shootT > 0) {
      this.shootT -= dt;
      k = Math.min(3, Math.floor((0.45 - this.shootT) / 0.11));
      frame = sh.anims.shoot[k];
      if (sh.glow) this.gl.texture = sh.glow.shoot[k];
    } else {
      k = Math.floor(this.walk * 6) % sh.anims.walk.length;
      frame = sh.anims.walk[k];
      if (sh.glow) this.gl.texture = sh.glow.walk[k];
    }
    this.spr.texture = frame;
    const px = Math.round(this.x), py = Math.round(this.y);
    this.spr.position.set(px, py);
    this.gl.position.set(px, py);
    this.spr.zIndex = py;
    this.spr.tint = this.hurtT > 0 ? 0xffb0a0 : 0xffffff;
    this.hurtT -= dt;
    this.bar.clear();
    const w = 20;
    this.bar.rect(px - w / 2 - 1, py - 27, w + 2, 4).fill({ color: 0x0a0406 });
    this.bar.rect(px - w / 2, py - 26, Math.max(0, Math.round(w * this.hp / this.hp0)), 2).fill({ color: 0xff5a3a });
  }

  destroy() {
    this.spr.destroy();
    this.gl.destroy();
    this.bar.destroy();
  }
}

// =============================================================================
// 敵の巣（奥で待つ。群れが着くと、残りのシロアリを送り出す。全部倒すと落ちる）
// =============================================================================
class Nest {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = 0;
    this.y = y;
    const run = lane.G.run;
    this.soldiers = foeCount(ev.soldiers ?? 0, run);
    this.workers = ev.workers ? foeCount(ev.workers, run) : 0;
    this.soldierHp = ev.soldierHp ?? 4;
    this.total = this.soldiers + this.workers;
    this.waveT = 0.5;
    this.flip = false;
    this.state = 'alive';
    const ms = lane.S.props.termite_mound;
    this.sheet = ms;
    this.spr = new Sprite(ms.anims.damage[0]);
    anchorOf(this.spr, ms);
    this.spr.position.set(0, Math.round(y));
    this.spr.zIndex = y;
    lane.swarm.layer.addChild(this.spr);
    this.gl = new Sprite(ms.glow ? ms.glow.damage[0] : ms.anims.damage[0]);
    this.gl.anchor.copyFrom(this.spr.anchor);
    this.gl.position.copyFrom(this.spr.position);
    this.gl.visible = !!ms.glow;
    lane.glow.addChild(this.gl);
  }

  get left() { return this.soldiers + this.workers; }

  update(dt) {
    if (this.state !== 'alive') return;
    const lane = this.lane;
    // 残りが減るほど巣が崩れていく
    const k = lane.foes / Math.max(1, lane.foes0);
    const st = k > 0.6 ? 0 : k > 0.35 ? 1 : k > 0.12 ? 2 : 3;
    this.spr.texture = this.sheet.anims.damage[st];
    if (this.sheet.glow) this.gl.texture = this.sheet.glow.damage[st];
    if (this.reachedT === undefined || lane.state !== 'run' || this.left <= 0) return;
    // 群れが着いたら、残りのシロアリが波になって出てくる
    this.waveT -= dt;
    if (this.waveT > 0) return;
    const N = CONFIG.nest;
    this.waveT = N.waveEvery;
    this.flip = !this.flip;
    const x = (Math.random() < 0.5 ? -1 : 1) * Math.random() * (HALF - 30);
    if ((this.flip || !this.workers) && this.soldiers > 0) {
      const n = Math.min(this.soldiers, N.soldierWave);
      this.soldiers -= n;
      for (let i = 0; i < n; i++) lane.addSoldier(x + (i - (n - 1) / 2) * 14, this.y + 20 - i * 6, this.soldierHp, N.rush);
    } else if (this.workers > 0) {
      const n = Math.min(this.workers, N.workerWave);
      this.workers -= n;
      lane.hordes.push(new Horde(lane, { x, n, w: 10 + n * 2, exact: true, speedMul: N.rush }, this.y + 24));
    }
  }

  destroy() {
    this.spr.destroy();
    this.gl.destroy();
  }
}

// =============================================================================
// ステージ全体
// =============================================================================
export class Lane {
  /**
   * @param G      ゲーム全体（view, sprites, swarm, fx, run …）
   * @param stage  course.js の1ステージ
   * @param hooks  { onClear({stars, kills, left, honey, flawless}), onWipe() }
   */
  constructor(G, stage, hooks) {
    this.G = G;
    this.S = G.sprites;
    this.swarm = G.swarm;
    this.fx = G.fx;
    this.stage = stage;
    this.hooks = hooks;
    this.under = new Container();
    this.top = new Container();
    this.glow = new Container();
    G.layers.under.addChild(this.under);
    G.layers.top.addChild(this.top);
    G.layers.glow.addChild(this.glow);
    this.T = textures();
    const run = G.run;
    this.events = stage.course.events.map((e) => ({ ...e }));
    if (run.mods.goldEvery && !this.events.some((e) => e.kind === 'gold')) {
      const gy = Math.round(stage.course.length * 0.55), gx = (Math.random() < 0.5 ? -1 : 1) * 40;
      this.events.push({ y: gy, kind: 'gold', x: gx });
    }
    this.events.sort((a, b) => a.y - b.y);
    // このステージのシロアリの数（上の「残り」）
    this.foes = 0;
    for (const e of this.events) {
      if (e.kind === 'horde' || e.kind === 'soldiers') this.foes += foeCount(e.n, run);
      else if (e.kind === 'beetle') this.foes += 1;
      else if (e.kind === 'nest') this.foes += foeCount(e.soldiers ?? 0, run) + (e.workers ? foeCount(e.workers, run) : 0);
    }
    this.foes0 = this.foes;
    this.next = 0;
    this.startY = this.swarm.y;
    this.length = stage.course.length;
    this.hordes = [];
    this.soldiers = [];
    this.eggs = [];
    this.cocoons = [];
    this.cages = [];
    this.panels = [];
    this.beetles = [];
    this.dangers = [];
    this.rocks = [];
    this.puddles = [];
    this.bullets = [];
    this.bulletPool = {};    // 弾の絵を使い回す（作っては捨てるとスマホで引っかかる）。絵の種類ごと
    this.kamikaze = [];
    this.runners = [];       // 卵から走ってくる仲間
    this.heroes = [];        // 助けた兵隊アリ
    this.nest = null;
    this.state = 'run';      // run / done
    this.time = 0;
    this.fireAcc = 0;
    this.biteT = 0;
    this.bombT = 1;
    this.lossAcc = 0;
    this.drownAcc = 0;
    this.kills = 0;
    this.stats = { gain: {}, loss: {} };   // 何でどれだけ増えた・減ったか（調整用）
    this.drops = [];         // 蜜のしずく（右上の数へ飛んでいく）
    this.dropPool = [];
    this.honeyPending = 0;   // 飛んでいる途中の蜜（届いてから右上の数を増やす）
    this.stageHoney = 0;     // このステージで集めた蜜
    this.combo = 0;          // 続けて倒した数
    this.lastKillT = -9;
    this.predAcc = 0;
    this.burstT = 0;         // 変異した直後の試し撃ち
    this.feverT = 0;         // 警報フェロモンで大暴れしている残り時間
    this.feverHint = (getSave().tips.fever || 0) < 3;   // 最初の3回はゲージに説明を出す
    if (this.feverHint) { getSave().tips.fever = (getSave().tips.fever || 0) + 1; save(); }
    this.grid = Array.from({ length: NB }, () => []);
    this.aimList = [];
    this.screenY = CONFIG.lane.swarmScreenY;
    const L = CONFIG.lane;
    const sw = this.swarm;
    sw.speed = L.speed;
    sw.bounds = { min: -HALF + 5, max: HALF - 5 };
    sw.obstacles = [];
    sw.followMul = 1;
    sw.setShape({ areaPerAnt: L.areaPerAnt, maxHalfWidth: L.maxHalfWidth, maxHalfHeight: L.maxHalfHeight });
    G.hud.bossBar(null);
    // 前のステージで助けた兵隊アリも一緒に
    for (let i = 0; i < (run.heroes || 0); i++) this.makeHero(i);
    // 1-1 の最初の3回だけ、出てきた物のそばに短い説明を出す（遊びながら覚える）
    this.hints = [];
    this.hintsOn = false;
    if (stage.index === 0) {
      const tips = getSave().tips;
      this.hintsOn = (tips.lane || 0) < 3;
      tips.lane = (tips.lane || 0) + 1;
      save();
    }
    G.hud.foes(this.foes);
  }

  addHint(obj, key, dy) {
    const el = document.createElement('div');
    el.className = 'hint';
    el.textContent = t('hint_' + key);
    document.getElementById('field-ui').appendChild(el);
    this.hints.push({ el, obj, dy, t: 0 });
  }

  updateHints(dt) {
    const sw = this.swarm;
    this.hints = this.hints.filter((h) => {
      const o = h.obj;
      h.t += dt;
      const gone = o.state === 'dead' || o.state === 'gone' || o.state === 'passed' || o.used || o.dead || o.done
        || (o !== this.nest && o.y > sw.y - sw.ry) || h.t > 8;
      if (gone) { h.el.remove(); return false; }
      const q = this.G.worldToCss(o.x, o.y + h.dy);
      h.half ??= h.el.offsetWidth / 2 + 6;
      h.el.style.left = Math.max(h.half, Math.min(this.G.view.cssW - h.half, q.x)) + 'px';
      h.el.style.top = q.y + 'px';
      h.el.style.opacity = String(Math.max(0, Math.min(1, (q.y - 90) / 40)));   // 上の表示と重ならないように
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // 群れの数
  // ---------------------------------------------------------------------------
  setCount(n, opts = {}) {
    const run = this.G.run;
    const before = run.count;
    n = Math.max(0, Math.min(CONFIG.lane.maxCount, Math.round(n)));
    run.count = n;
    run.maxCount = Math.max(run.maxCount, n);
    this.swarm.setCount(n, opts);
    if (n > before) sfx.count(n);
    if (n <= 0 && before > 0) this.hooks.onWipe?.();
  }

  /** k 匹増やす（上限を超えた分は蜜）。実際に増えた数を返す */
  gain(k, at, why = 'other') {
    const run = this.G.run;
    const add = Math.max(0, Math.min(k, CONFIG.lane.maxCount - run.count));
    this.stats.gain[why] = (this.stats.gain[why] || 0) + add;
    if (add > 0) this.setCount(run.count + add, { from: at });
    if (k > add) this.honey((k - add) * CONFIG.lane.overflowHoney, at?.x ?? this.swarm.x, at?.y ?? this.swarm.y);
    return add;
  }

  /** k 匹失う。at の近くのアリから消える。armor=true なら甲殻装甲で減る数が少なくなる */
  loseAnts(k, opts = {}) {
    const run = this.G.run;
    if (opts.armor) {
      k *= (1 - CONFIG.armor.reduce[run.armor]) * run.mods.dmgTaken * inv(run, 'hitPer');
      k = Math.max(opts.min ?? 1, Math.round(k));
    }
    k = Math.min(k, run.count);
    if (k <= 0) return 0;
    const why = opts.why || 'other';
    this.stats.loss[why] = (this.stats.loss[why] || 0) + k;
    if (why !== 'bomb') this.addFever(k * CONFIG.fever.perLoss);   // 追い込まれるほど早くたまる
    const at = opts.at;
    const pick = opts.pick || (at ? (a) => Math.hypot(a.x - at.x, a.y - at.y) : undefined);
    this.setCount(run.count - k, { pick, removedBurst: opts.burst !== false });
    return k;
  }

  /** 卵から1匹ずつ走ってくる仲間（着いたら +1） */
  addRunner(x, y, delay) {
    const V = this.S.ants[this.swarm.variant] || this.S.ants.base;
    const s = new Sprite(V.color[0][0]);
    s.anchor.set(0.5);
    s.position.set(Math.round(x), Math.round(y));
    this.top.addChild(s);
    this.runners.push({ s, V, x0: x, y0: y, x, y, t: -delay, dur: 0.38 + Math.random() * 0.12 });
  }

  updateRunners(dt) {
    if (!this.runners.length) return;
    const sw = this.swarm;
    const keep = [];
    for (const r of this.runners) {
      r.t += dt;
      if (r.t < 0) { keep.push(r); continue; }
      const p = Math.min(1, r.t / r.dur), e = p * (2 - p);
      const tx = sw.x + (Math.random() - 0.5) * 4, ty = sw.y - sw.ry * 0.3;
      r.x = r.x0 + (tx - r.x0) * e;
      r.y = r.y0 + (ty - r.y0) * e - Math.sin(p * Math.PI) * 14;
      const dir = ((Math.round(Math.atan2(tx - r.x0, -(ty - r.y0)) / (Math.PI / 4)) % 8) + 8) % 8;
      r.s.texture = r.V.color[dir][Math.floor(r.t * 30) % 8];
      r.s.position.set(Math.round(r.x), Math.round(r.y));
      if (p < 1) { keep.push(r); continue; }
      r.s.destroy();
      if (this.state === 'run' || this.state === 'done') {
        const got = this.gain(1, { x: r.x, y: r.y }, 'egg');
        if (got) this.G.popupNum(r.x + (Math.random() - 0.5) * 10, r.y - 12, '+1', 0xb8ffb0);
      }
    }
    this.runners = keep;
  }

  /** 助けた兵隊アリが群れの先頭に加わる */
  addHero(x, y) {
    const run = this.G.run, H = CONFIG.hero;
    if ((run.heroes || 0) >= H.max) {
      this.honey(H.extraHoney, x, y);
      this.G.popup(x, y - 20, t('hero_more'), 'graze');
      return;
    }
    run.heroes = (run.heroes || 0) + 1;
    const h = this.makeHero(run.heroes - 1);
    h.x = x;
    h.y = y;
    h.join = 0.45;
    this.G.popup(x, y - 30, t('hero_join'), 'mutate up');
    this.G.flash(0xffd040, 0.25);
  }

  makeHero(i) {
    const V = this.S.ants[CONFIG.hero.variant];
    const s = new Sprite(V.color[0][0]);
    s.anchor.set(0.5);
    s.scale.set(2);
    this.top.addChild(s);
    const gl = new Sprite(V.glow[0][0]);
    gl.anchor.set(0.5);
    gl.scale.set(2);
    gl.tint = 0xffd040;
    this.glow.addChild(gl);
    const h = { s, gl, V, slot: i === 0 ? 0 : (i % 2 ? -1 : 1), x: this.swarm.x, y: this.swarm.y - 20, fireT: Math.random() * 0.2, walk: 0, join: 0 };
    this.heroes.push(h);
    return h;
  }

  updateHeroes(dt) {
    if (!this.heroes.length) return;
    const sw = this.swarm, H = CONFIG.hero;
    for (const h of this.heroes) {
      const tx = sw.x + h.slot * 18, ty = sw.y - sw.ry * 0.25;   // 群れのまんなかで先頭に立つ
      const k = Math.min(1, dt * (h.join > 0 ? 6 : 10));
      h.join -= dt;
      h.x += (tx - h.x) * k;
      h.y += (ty - h.y) * k;
      h.walk += dt;
      const f = Math.floor(h.walk * 14) % 8;
      h.s.texture = h.V.color[0][f];
      h.gl.texture = h.V.glow[0][f];
      h.s.position.set(Math.round(h.x), Math.round(h.y));
      h.gl.position.copyFrom(h.s.position);
      h.gl.alpha = 0.5 + 0.3 * Math.sin(this.time * 4);
      if (this.state !== 'run' || sw.count <= 0) continue;
      h.fireT -= dt * (this.feverT > 0 ? CONFIG.fever.fireMul : 1);
      if (h.fireT <= 0) {
        h.fireT = H.every;
        this.spawnBullet(h.x, h.y - 16, { kind: 'hero', lv: 3, pierce: H.pierce }, H.damage * this.G.run.mods.dmgMul);
        this.fx.spark(this.fx.glow, h.x, h.y - 18, { color: 0xffe080, life: 0.06, drag: 0 });
      }
    }
  }

  /** 板に触れた */
  applyPanel(p) {
    const run = this.G.run, sw = this.swarm;
    const at = { x: p.x, y: p.y };
    if (p.kind === 'gold') {
      const got = this.gain(run.count, at, 'gold');
      this.G.popupNum(p.x, p.y - 18, '+' + formatCount(got), GOLD.text);
      sfx.multiply();
      this.G.slowmo();
      this.G.flash(0xffd420, 0.25);
      return;
    }
    if (p.v > 0) {
      const v = Math.round(p.v * run.mods.addMul);
      const got = this.gain(v, at, p.kind);
      this.G.popupNum(p.x, p.y - 12, '+' + formatCount(got), GOOD.text);
      sfx.gateGood();
    } else if (p.v < 0) {
      const lost = this.loseAnts(Math.max(1, Math.round(-p.v * run.mods.dmgTaken)), { at: { x: sw.x, y: sw.y - sw.ry }, why: 'board' });
      this.G.popupNum(p.x, p.y - 12, '-' + formatCount(lost), BAD.text);
      sfx.gateBad();
      this.G.flash(0xff3a2a, 0.18);
    }
  }

  /** 繭が割れた → 変異 */
  mutate(mut, x, y) {
    const run = this.G.run;
    const r = applyMutation(run, mut);
    this.swarm.setVariant(variantName(run), { ...swarmLook(run), sweep: true });
    if (run.mods.mutateGain > 0) this.gain(Math.max(1, Math.round(run.count * run.mods.mutateGain)), { x, y });
    sfx.mutate();
    this.G.flash(MUT_COLOR[mut], 0.25);
    const name = t('mut_' + r.kind) + ' ' + t('lv', { n: r.lv });
    const up = r.lv > 1 && !r.switched;
    this.G.popup(x, y - 34, up ? `${t('lvup')} ${name}` : t(r.switched ? 'mutate_switch' : 'mutate', { name }), up ? 'mutate up' : 'mutate', t('mut_desc_' + r.kind));
    this.burstT = CONFIG.shot.burstTime;   // 新しい力をすぐに試し撃ち
    this.G.hud.refresh();
  }

  addDanger(x, y, r, warn, owner) {
    x = Math.max(-HALF + r * 0.5, Math.min(HALF - r * 0.5, x));
    const g = new Graphics();
    this.under.addChild(g);
    const gl = new Graphics();
    this.glow.addChild(gl);
    this.dangers.push({ x, y, r, warn, t: 0, g, gl, owner });
    sfx.warn();
  }

  addHorde(ev, y) {
    const h = new Horde(this, ev, y);
    this.hordes.push(h);
    return h;
  }

  addSoldier(x, y, hp, speedMul = 1) {
    const s = new Soldier(this, Math.max(-HALF + 6, Math.min(HALF - 6, x)), y, hp, speedMul);
    this.soldiers.push(s);
    return s;
  }

  // ---------------------------------------------------------------------------
  // 残りのシロアリ・倒したとき
  // ---------------------------------------------------------------------------
  /** シロアリが倒れた・逃げた：上の「残り」が減る */
  foeDown(n) {
    this.foes = Math.max(0, this.foes - n);
    this.G.hud.foes(this.foes);
  }

  /** 倒した数・連続撃破・蜜・警報フェロモン・捕食の法則 */
  countKill(x, y, big = false) {
    this.kills++;
    this.G.run.kills = (this.G.run.kills || 0) + 1;
    this.addFever(big ? CONFIG.fever.perSoldier : CONFIG.fever.perKill);
    if (this.kills % CONFIG.horde.killsPerHoney === 0) this.honey(1, x, y, 1);
    sfx.pop();
    // 続けて倒すと、節目でほめる
    this.combo = this.time - this.lastKillT < CONFIG.horde.comboGap ? this.combo + 1 : 1;
    this.lastKillT = this.time;
    const ci = CONFIG.horde.combo.indexOf(this.combo);
    if (ci >= 0) this.praiseCombo(ci);
    // 捕食の法則：倒したシロアリの場所から仲間が増える
    const pr = this.G.run.mods.predation;
    if (pr > 0) {
      this.predAcc += pr;
      if (this.predAcc >= 1) {
        const k = Math.floor(this.predAcc);
        this.predAcc -= k;
        this.gain(k, { x, y }, 'devour');
      }
    }
  }

  buildGrid() {
    for (const b of this.grid) b.length = 0;
    for (const h of this.hordes) {
      for (const u of h.units) if (!u.dead) this.grid[bucketOf(u.x)].push(u);
    }
  }

  /** x0〜x1 の範囲にいる働きシロアリ */
  unitsIn(x0, x1, fn) {
    const k0 = bucketOf(x0), k1 = bucketOf(x1);
    for (let k = k0; k <= k1; k++) {
      for (const u of this.grid[k]) if (!u.dead && fn(u) === false) return;
    }
  }

  killUnit(u, cause) {
    if (u.dead) return;
    u.dead = true;
    const h = u.horde;
    h.alive--;
    h.lastDeath = this.time;
    const fx = this.fx;
    if (cause === 'clash') {
      fx.burst(fx.over, u.x, u.y, 3, { color: [0x8a7048, 0x3a111b, 0x9a5222], speed: [20, 60], life: [0.15, 0.35], drag: 6 });
    } else if (cause === 'flee') {
      fx.burst(fx.over, u.x, u.y, 3, { color: [0xd8c0a0, 0x8a7048], speed: [20, 60], life: [0.2, 0.4], drag: 5 });
    } else {
      // 弾ける：白い煙の粒と、割れた殻
      fx.burst(fx.glow, u.x, u.y - 2, 3, { color: cause === 'poison' ? [FXC.green, 0xd8ffc8] : cause === 'trample' ? [0xff7a3a, 0xffe0b0] : [0xfff4e0, 0xffe0b0], speed: [15, 45], life: [0.12, 0.28], drag: 6 });
      fx.burst(fx.over, u.x, u.y, 4, { color: [0xd8c0a0, 0x8a7048, 0x6a5538], speed: [25, 80], life: [0.2, 0.5], drag: 5 });
      h.shot++;
      this.countKill(u.x, u.y, false);
    }
    this.foeDown(1);
    // 倒れた姿をその場に少し残す（絵は大群ごと片づけるときに消す。1匹ずつ消すと重くなる）
    u.corpse = CONFIG.horde.corpse;
    u.s.tint = 0x5a4836;
    u.s.alpha = 0.85;
    u.lit.alpha = 0;
    // ヒアリの毒：倒れたシロアリから、となりへ広がる
    if (u.poisoned && cause !== 'flee') this.spreadPoison(u);
    // 大群を撃ちきった
    if (h.alive <= 0 && (cause === 'shot' || cause === 'poison') && h.n0 >= CONFIG.horde.bigWipe && h.shot >= h.n0 * 0.6) {
      this.G.popup(u.x, u.y - 20, t('wiped', { n: h.shot }), 'graze');
      this.G.slowmo();
      this.G.view.shake(CONFIG.feel.shakeSmall);
      fx.ring(fx.glow, u.x, u.y, 4, 26, 0.4, 0xffffff, 0.7);
    }
  }

  /** 警報フェロモンのゲージを足す */
  addFever(n) {
    if (this.feverT > 0 || this.state !== 'run') return;
    const run = this.G.run, F = CONFIG.fever;
    const was = run.fever || 0;
    run.fever = Math.min(F.max, was + n);
    if (was < F.max && run.fever >= F.max) sfx.feverReady();
  }

  /** 前に敵がいるか（満タンになっても、敵がいないところでは始めない） */
  enemyAhead() {
    const sw = this.swarm, R = CONFIG.shot.range;
    for (const s of this.soldiers) if (!s.dead && s.y < sw.y + 10 && sw.y - s.y < R) return true;
    for (const h of this.hordes) {
      if (h.wiped) continue;
      for (const u of h.units) if (!u.dead && u.y < sw.y && sw.y - u.y < R) return true;
    }
    return false;
  }

  startFever() {
    const G = this.G, sw = this.swarm, F = CONFIG.fever;
    G.run.fever = 0;
    this.feverT = F.time;
    G.banner(t('fever'), 'fever', t('fever_sub'));
    G.flash(0xff2a00, 0.35);
    G.view.shake(3);
    G.hitstop(0.05);
    sfx.fever();
    for (const a of sw.ants) sw.flashAnt(a, 0xff3a1a);
    this.fx.ring(this.fx.glow, sw.x, sw.y, 4, 30, 0.5, 0xff5a2a, 1);
  }

  updateFever(dt) {
    const F = CONFIG.fever, sw = this.swarm, run = this.G.run;
    if (this.feverT > 0) {
      this.feverT -= dt;
      // 群れがちらちらと赤く光る
      if (Math.random() < dt * 30 && sw.ants.length) {
        for (let i = 0; i < 4; i++) sw.flashAnt(sw.ants[Math.floor(Math.random() * sw.ants.length)], 0xff3a1a);
      }
      if (Math.random() < dt * 20) this.fx.spark(this.fx.glow, sw.x + (Math.random() - 0.5) * sw.rx * 2, sw.y + (Math.random() - 0.5) * sw.ry, { color: 0xff7a3a, vy: -30, life: 0.4, drag: 1 });
      this.G.hud.fever(Math.max(0, this.feverT / F.time), 'on');
      return;
    }
    const full = (run.fever || 0) >= F.max;
    if (full && this.state === 'run' && this.enemyAhead()) { this.startFever(); return; }
    this.G.hud.fever((run.fever || 0) / F.max, full ? 'ready' : 'fill', this.feverHint);
  }

  praiseCombo(i) {
    const sw = this.swarm, G = this.G;
    G.popup(sw.x, sw.y - sw.ry - 40, t('combo', { n: this.combo }), 'combo');
    sfx.combo(i);
    if (i >= 2) G.view.shake(CONFIG.feel.shakeSmall);
    if (i >= 1) this.honey(i, sw.x, sw.y - sw.ry - 24);
  }

  /** 蜜を足す（しずくが右上の数へ飛んでいき、届いたら数が増える） */
  honey(amount, x, y, drops) {
    if (amount <= 0) return;
    const run = this.G.run, before = run.honey || 0;
    addHoney(run, amount);
    const got = (run.honey || 0) - before;
    this.stageHoney += got;
    const n = drops ?? Math.min(12, Math.max(1, Math.round(amount)));
    this.honeyPending += got;
    for (let i = 0; i < n; i++) this.spawnDrop(x, y, got / n);
  }

  spawnDrop(x, y, v) {
    let s = this.dropPool.pop();
    if (!s) {
      s = new Sprite(this.T.disc[1]);
      s.anchor.set(0.5);
      s.tint = 0xffc830;
      this.glow.addChild(s);
    }
    s.alpha = 1;
    const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60;
    this.drops.push({ s, x, y, v, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0 });
  }

  updateDrops(dt) {
    const run = this.G.run;
    if (this.drops.length) {
      const view = this.G.view;
      const tx = view.camX + view.W / 2 - 18, ty = view.camY - view.H / 2 + 30;   // 右上の蜜の数
      const keep = [];
      for (const d of this.drops) {
        d.t += dt;
        if (d.t < 0.25) {
          const k = Math.exp(-dt * 4);
          d.vx *= k;
          d.vy *= k;
        } else {
          const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy) || 1;
          if (dist < 10) {
            d.s.alpha = 0;
            this.dropPool.push(d.s);
            this.honeyPending -= d.v;
            sfx.honey();
            continue;
          }
          const sp = 200 + d.t * 500;
          d.vx += ((dx / dist) * sp - d.vx) * Math.min(1, dt * 8);
          d.vy += ((dy / dist) * sp - d.vy) * Math.min(1, dt * 8);
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.s.position.set(Math.round(d.x), Math.round(d.y));
        keep.push(d);
      }
      this.drops = keep;
    }
    if (!this.drops.length) this.honeyPending = 0;
    this.G.hud.honey(Math.floor((run.honey || 0) - this.honeyPending + 1e-6));
  }

  poisonUnit(u, time) {
    if (u.dead || u.poisoned) return;
    u.poisoned = true;
    u.poison = time * this.G.run.mods.poisonMul;
  }

  spreadPoison(u) {
    const w = this.G.run.weapon;
    if (!w || w.type !== 'fire') return;
    const A = CONFIG.arms.fire, lv = w.lv;
    const R = A.spreadR[lv - 1];
    const near = [];
    this.unitsIn(u.x - R, u.x + R, (o) => {
      if (!o.poisoned && Math.hypot(o.x - u.x, o.y - u.y) < R) near.push(o);
    });
    near.sort((p, q) => Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y));
    for (const o of near.slice(0, A.spread[lv - 1] + this.G.run.mods.poisonSpread)) {
      if (Math.random() < A.spreadChance) this.poisonUnit(o, A.poisonTime * (0.7 + Math.random() * 0.6));
    }
  }

  /** 群れと働きシロアリがぶつかった：1匹ずつ相殺（大暴れ中は踏みつぶす） */
  contacts() {
    const sw = this.swarm;
    if (sw.count <= 0) return;
    const rx = sw.rx + 3, ry = sw.ry + 3;
    let lost = 0, cx = 0, cy = 0, n = 0;
    this.unitsIn(sw.x - rx, sw.x + rx, (u) => {
      const dx = (u.x - sw.x) / rx, dy = (u.y - sw.y) / ry;
      if (dx * dx + dy * dy < 1) {
        if (this.feverT > 0) { this.killUnit(u, 'trample'); return; }
        this.killUnit(u, 'clash');
        lost += 1;
        cx += u.x;
        cy += u.y;
        n++;
      }
    });
    if (!n) return;
    const run = this.G.run;
    this.lossAcc += lost * (1 - CONFIG.armor.reduce[run.armor]) * run.mods.clashLoss;
    const k = Math.floor(this.lossAcc);
    this.lossAcc -= k;
    if (k > 0) this.loseAnts(k, { at: { x: cx / n, y: cy / n }, why: 'clash' });
    this.fx.burst(this.fx.glow, cx / n, cy / n, Math.min(8, 2 + n), { color: [0xff7a68, 0xffffff], speed: [20, 60], life: [0.1, 0.25], drag: 6 });
    sfx.cancel();
  }

  // ---------------------------------------------------------------------------
  // 射撃（弾1発で数字がちょうど1ずつ減る）
  // ---------------------------------------------------------------------------
  weaponInfo() {
    const run = this.G.run, w = run.weapon, m = run.mods, A = CONFIG.arms;
    let rate = CONFIG.shot.perAnt, dmg = CONFIG.shot.damage, kind = 'acid', pierce = 0;
    if (w?.type === 'fire') {
      kind = 'venom';
      dmg = A.fire.damage[w.lv - 1];
    }
    if (w?.type === 'bullet') {
      kind = 'sting';
      rate *= A.bullet.rateMul;
      dmg = A.bullet.damage[w.lv - 1];
      pierce = A.bullet.pierce[w.lv - 1] + m.pierce;
    }
    if (w?.type === 'bomb') rate *= A.bomb.rateMul;
    if (w?.type === 'mandible') rate *= A.mandible.rateMul;
    if (this.burstT > 0) rate *= CONFIG.shot.burstMul;
    if (this.feverT > 0) { rate *= CONFIG.fever.fireMul; dmg *= CONFIG.fever.dmgMul; }
    return { rate: rate / m.fireRate, dmg: dmg * m.dmgMul, kind, lv: w?.lv ?? 0, pierce };
  }

  fire(dt) {
    const sw = this.swarm;
    if (sw.count <= 0 || !sw.ants.length) return;
    const W = this.weaponInfo();
    const want = sw.count * W.rate;
    const perSec = Math.min(want, this.feverT > 0 ? CONFIG.fever.maxPerSec : CONFIG.shot.maxPerSec);
    const dmg = W.dmg * (want / Math.max(1e-6, perSec));   // 弾の数の上限を超えた分は、1発を強くする
    this.fireAcc += perSec * dt;
    let shots = 0;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      const a = sw.ants[Math.floor(Math.random() * sw.ants.length)];
      this.spawnBullet(a.x, a.y - 7, W, dmg);
      this.fx.spark(this.fx.glow, a.x, a.y - 8, { color: W.kind === 'venom' ? FXC.green : W.kind === 'sting' ? FXC.purple : 0xffe27a, life: 0.05, drag: 0 });
      shots++;
    }
    if (!shots) return;
    if (W.kind === 'sting') sfx.sting();
    else if (W.kind === 'venom') sfx.venom();
    else sfx.shoot();
  }

  /** 弾の絵（Lv が上がるほど大きく派手に） */
  bulletKey(W) {
    const i = Math.max(0, Math.min(2, W.lv - 1));
    if (W.kind === 'venom') return ['glob', 'glob7', 'glob9'][i];
    if (W.kind === 'sting') return ['lance', 'lance5', 'lance7'][i];
    if (W.kind === 'hero') return 'lance5';
    return 'streak';
  }

  bulletTint(kind) {
    if (kind === 'venom') return FXC.green;
    if (kind === 'sting') return FXC.purple;
    if (kind === 'hero') return 0xffd040;
    return this.feverT > 0 ? CONFIG.fever.tint : 0xffd860;   // 蟻酸のしずく：明るい黄色の筋（大暴れ中は赤く燃える）
  }

  spawnBullet(x, y, W, dmg) {
    const T = this.T, key = this.bulletKey(W);
    const pool = (this.bulletPool[key] ||= []);
    let s = pool.pop();
    if (!s) {
      s = new Sprite(T[key]);
      s.anchor.set(0.5, 0);
      this.glow.addChild(s);
    }
    s.alpha = 1;
    s.tint = this.bulletTint(W.kind);
    s.position.set(Math.round(x), Math.round(y));
    const long = W.kind === 'sting' || W.kind === 'hero';
    const range = CONFIG.shot.range * (long ? 1.2 : 1) * this.G.run.mods.rangeMul;
    // 前にいる的へ、弾が少し曲がって集まる（群れの撃った弾が的に吸い込まれる）
    let vx = 0;
    const tg = this.aimAt(x, y, range);
    const sp = CONFIG.shot.speed * (long ? 1.2 : 1);
    if (tg) {
      const S = CONFIG.shot;
      vx = Math.max(-S.aimMax, Math.min(S.aimMax, (tg.x - x) / Math.max(8, y - tg.y))) * sp;
    }
    this.bullets.push({ s, key, x, y, vx, sp, py: y, y0: y, range, dmg, kind: W.kind, lv: W.lv, pierce: W.pierce, hit: null });
  }

  updateBullets(dt) {
    const top = this.camY() - this.G.view.H / 2 - 20;
    const keep = [];
    for (const b of this.bullets) {
      b.py = b.y;
      b.y -= b.sp * dt;
      b.x += b.vx * dt;
      if (this.bulletHits(b) || b.y < top) { this.freeBullet(b); continue; }
      const left = b.range - (b.y0 - b.y);
      if (left <= 0) {   // 届く距離の終わり：しずくが散る
        if (Math.random() < 0.3) this.fx.spark(this.fx.over, b.x, b.y, { color: b.kind === 'venom' ? FXC.greenDeep : 0x8a7a50, life: 0.12, drag: 6 });
        this.freeBullet(b);
        continue;
      }
      b.s.alpha = Math.min(1, left / 40);
      b.s.position.set(Math.round(b.x), Math.round(b.y));
      keep.push(b);
    }
    this.bullets = keep;
  }

  /** 弾の狙い：前の円すいの中で、いちばん近い的 */
  aimAt(x, y, range) {
    const cone = CONFIG.shot.aimCone;
    let best = null, bd = 1e9;
    const consider = (tx, ty) => {
      const dy = y - ty;
      if (dy < 6 || dy > range) return;
      const dx = Math.abs(tx - x);
      if (dx > 4 + dy * cone) return;
      const d = dy + dx * 1.5;
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    };
    const span = 4 + range * cone;
    this.unitsIn(x - span, x + span, (u) => { consider(u.x, u.y); });
    for (const tg of this.aimList) consider(tg.x, tg.y);
    return best;
  }

  /** 大きな的の狙う点（毎フレーム作り直す） */
  buildAimList() {
    const L = this.aimList;
    L.length = 0;
    for (const s of this.soldiers) if (!s.dead) L.push({ x: s.x, y: s.y - 6 });
    for (const e of this.eggs) if (e.state === 'alive') L.push({ x: e.x, y: e.y - 6 });
    for (const c of this.cocoons) if (c.state === 'alive') L.push({ x: c.x, y: c.y - 10 });
    for (const c of this.cages) if (c.state === 'alive') L.push({ x: c.x, y: c.y - 14 });
    for (const e of this.beetles) if (!e.dead) L.push({ x: e.x, y: e.y });
    for (const p of this.panels) if (p.kind === 'board' && !p.used && p.v < p.cap) L.push({ x: p.x, y: p.y + p.h / 2 });
  }

  freeBullet(b) {
    // 消さずに透明にして使い回す（絵を出し入れすると、描く準備のやり直しで重くなる）
    b.s.alpha = 0;
    this.bulletPool[b.key].push(b.s);
  }

  /** 弾が何かに当たったら true（弾は消える） */
  bulletHits(b) {
    const HR = CONFIG.horde.hitR;
    let stop = false;
    this.unitsIn(b.x - HR, b.x + HR, (u) => {
      if (b.hit?.has(u)) return true;
      if (Math.abs(u.x - b.x) < HR && u.y > b.y - 4 && u.y < b.py + 6) {
        this.hitUnit(u, b);
        if (b.pierce > 0) {
          b.pierce--;
          (b.hit ||= new Set()).add(u);
          return true;
        }
        stop = true;
        return false;
      }
      return true;
    });
    if (stop) return true;
    for (const s of this.soldiers) {
      if (s.dead || b.hit?.has(s)) continue;
      if (Math.abs(b.x - s.x) < s.r && b.y < s.y + 3 && b.y > s.y - 16) {
        s.damage(b.dmg, b.kind);
        this.impact(b, b.x, b.y);
        if (b.pierce > 0) { b.pierce--; (b.hit ||= new Set()).add(s); continue; }
        return true;
      }
    }
    for (const c of this.cocoons) {
      if (c.state === 'alive' && Math.abs(b.x - c.x) < c.r && b.y < c.y + 4 && b.y > c.y - 22) {
        c.damage(b.dmg);
        this.impact(b, b.x, b.y);
        return true;
      }
    }
    for (const e of this.eggs) {
      if (e.state === 'alive' && Math.abs(b.x - e.x) < e.r && b.y < e.y + 4 && b.y > e.y - 16) {
        e.damage(b.dmg);
        this.impact(b, b.x, b.y);
        return true;
      }
    }
    for (const c of this.cages) {
      if (c.state === 'alive' && Math.abs(b.x - c.x) < c.r && b.y < c.y + 4 && b.y > c.y - 34) {
        c.damage(b.dmg);
        this.impact(b, b.x, b.y);
        return true;
      }
    }
    for (const p of this.panels) {
      if (p.kind !== 'board' || p.used) continue;
      const yb = p.y + p.h / 2;
      if (b.py >= yb && b.y < yb && Math.abs(b.x - p.x) < p.w / 2) {
        if (p.hit(1)) sfx.gateHit();
        this.fx.spark(this.fx.glow, b.x, yb, { color: p.colors.text, life: 0.15, drag: 6 });
        return true;
      }
    }
    for (const e of this.beetles) {
      if (e.dead || b.hit?.has(e)) continue;
      if (Math.abs(b.x - e.x) < e.r && Math.abs(b.y - e.y) < e.r) {
        e.damage(b.dmg);
        if (b.kind === 'venom') e.poison += CONFIG.arms.fire.dot[b.lv - 1] * this.G.run.mods.poisonMul;
        this.impact(b, b.x, b.y);
        if (b.pierce > 0) { b.pierce--; (b.hit ||= new Set()).add(e); continue; }
        return true;
      }
    }
    for (const r of this.rocks) {
      if (Math.hypot(b.x - r.x, (b.y - r.y) * 1.25) < r.r) {
        this.fx.burst(this.fx.over, b.x, b.y, 2, { color: 0x8a8070, speed: [10, 30], life: [0.1, 0.2], drag: 6 });
        return true;
      }
    }
    return false;
  }

  hitUnit(u, b) {
    u.hp -= b.dmg;
    if (b.kind === 'venom') this.poisonUnit(u, CONFIG.arms.fire.poisonTime);
    this.impact(b, u.x, u.y);
    if (u.hp <= 0) this.killUnit(u, 'shot');
  }

  impact(b, x, y) {
    const fx = this.fx;
    if (b.kind === 'venom') fx.burst(fx.glow, x, y, 3, { color: [FXC.green, FXC.greenDeep], speed: [15, 45], life: [0.12, 0.3], drag: 6 });
    else if (b.kind === 'sting' || b.kind === 'hero') fx.burst(fx.glow, x, y, 4, { color: [b.kind === 'hero' ? 0xffd040 : FXC.purple, 0xffffff], speed: [40, 90], life: [0.1, 0.22], drag: 8 });
    else fx.spark(fx.glow, x, y, { color: 0xfff0c0, life: 0.08, drag: 6 });
  }

  // ---------------------------------------------------------------------------
  // 武器（アギトアリの顎・自爆アリの突撃）
  // ---------------------------------------------------------------------------
  weapons(dt) {
    const w = this.G.run.weapon;
    if (!w || this.swarm.count <= 0) return;
    if (w.type === 'mandible') this.bite(dt, w.lv);
    else if (w.type === 'bomb') this.launchBombs(dt, w.lv);
  }

  /** アギトアリ：群れのすぐ前の敵を、顎でまとめてはじき飛ばす（近いほど強い） */
  bite(dt, lv) {
    this.biteT -= dt;
    if (this.biteT > 0) return;
    const A = CONFIG.arms.mandible, sw = this.swarm, jm = this.G.run.mods.jawMul;
    const range = A.range[lv - 1] * jm;
    const front = sw.y - sw.ry;
    const x0 = sw.x - sw.rx - 8, x1 = sw.x + sw.rx + 8;
    const inRange = (x, y, r = 0) => x > x0 - r && x < x1 + r && y > front - range - r && y < sw.y + 4;
    const cand = [];
    this.unitsIn(x0, x1, (u) => { if (inRange(u.x, u.y)) cand.push(u); });
    let any = cand.length > 0;
    cand.sort((p, q) => q.y - p.y);
    const kills = Math.round(A.kills[lv - 1] * jm);
    cand.forEach((u, i) => {
      if (i < kills) this.killUnit(u, 'shot');
      else u.oy -= A.knock[lv - 1];   // 倒しきれない分は、はじき飛ばす
    });
    const D = A.bigDamage[lv - 1] * jm;
    for (const s of this.soldiers) if (!s.dead && inRange(s.x, s.y, s.r)) { s.damage(D); any = true; }
    for (const e of this.eggs) if (e.state === 'alive' && inRange(e.x, e.y, e.r)) { e.damage(D); any = true; }
    for (const c of this.cocoons) if (c.state === 'alive' && inRange(c.x, c.y, c.r)) { c.damage(D); any = true; }
    for (const c of this.cages) if (c.state === 'alive' && inRange(c.x, c.y, c.r)) { c.damage(D); any = true; }
    for (const e of this.beetles) if (!e.dead && inRange(e.x, e.y, e.r)) { e.damage(D); e.y -= A.knock[lv - 1] * 0.5; any = true; }
    if (any) {
      this.biteT = A.every[lv - 1] / (this.feverT > 0 ? 2 : 1);
      this.fx.snap(sw, lv);
      sfx.snap();
    } else this.biteT = 0.06;
  }

  /** 自爆アリ：前のアリが敵へ走り、群れの中で爆発する（使うたびに群れが減る） */
  launchBombs(dt, lv) {
    this.bombT -= dt;
    if (this.bombT > 0) return;
    const Bm = CONFIG.arms.bomb, sw = this.swarm;
    if (sw.count < Bm.minCount) { this.bombT = 0.3; return; }
    const target = this.bombTarget(Bm.reach);
    if (!target) { this.bombT = 0.15; return; }
    this.bombT = Bm.every[lv - 1] / (this.feverT > 0 ? 2 : 1);
    const n = Math.min(Bm.ants[lv - 1], Math.max(0, sw.count - 1));
    if (n <= 0) return;
    const V = this.S.ants[sw.variant];
    for (const a of sw.frontAnts(n)) {
      const body = new Sprite(V.color[0][0]);
      body.anchor.set(0.5);
      const flash = new Sprite(V.white[0][0]);
      flash.anchor.set(0.5);
      flash.tint = FXC.yellow;
      this.top.addChild(body);
      this.glow.addChild(flash);
      this.kamikaze.push({ body, flash, x: a.x, y: a.y, target, t: 0, walk: 0, V, lv });
    }
    this.loseAnts(n, { pick: (a) => a.y, burst: false, why: 'bomb' });
  }

  /** 爆弾の狙い：大群のいちばん密なところ、兵隊シロアリ、ゴミムシ、卵 */
  bombTarget(reach) {
    const sw = this.swarm;
    let best = null, bestN = 0;
    for (const h of this.hordes) {
      if (h.wiped) continue;
      let sx = 0, sy = 0, n = 0;
      for (const u of h.units) {
        if (u.dead || u.y > sw.y - sw.ry || sw.y - u.y > reach) continue;
        sx += u.x; sy += u.y; n++;
      }
      if (n > bestN) { bestN = n; best = { horde: h, x: sx / n, y: sy / n }; }
    }
    if (best && bestN < CONFIG.arms.bomb.minHorde) best = null;
    if (best) {
      // 大群は動くので、その中のシロアリを1匹狙う
      let pick = null, d = 1e9;
      for (const u of best.horde.units) {
        if (u.dead) continue;
        const dd = Math.hypot(u.x - best.x, u.y - best.y);
        if (dd < d) { d = dd; pick = u; }
      }
      return pick;
    }
    const cand = [];
    for (const s of this.soldiers) if (!s.dead && s.y < sw.y && sw.y - s.y < reach) cand.push(s);
    for (const e of this.beetles) if (!e.dead && e.y < sw.y && sw.y - e.y < reach) cand.push(e);
    for (const e of this.eggs) if (e.state === 'alive' && sw.y - e.y < reach * 0.8) cand.push(e);
    cand.sort((p, q) => Math.hypot(p.x - sw.x, p.y - sw.y) - Math.hypot(q.x - sw.x, q.y - sw.y));
    return cand[0] || null;
  }

  updateKamikaze(dt) {
    const keep = [];
    for (const k of this.kamikaze) {
      k.t += dt;
      const tx = k.target.x, ty = k.target.y;
      const d = Math.hypot(tx - k.x, ty - k.y);
      const sp = 130;
      if (d > 5 && k.t < 2.2) {
        k.x += (tx - k.x) / d * sp * dt;
        k.y += (ty - k.y) / d * sp * dt;
        k.walk += sp * dt;
        const dir = Math.round(Math.atan2(tx - k.x, -(ty - k.y)) / (Math.PI / 4));
        const di = ((dir % 8) + 8) % 8;
        const f = Math.floor(k.walk / 2.4) % 8;
        k.body.texture = k.V.color[di][f];
        k.flash.texture = k.V.white[di][f];
        k.flash.alpha = (0.5 + 0.5 * Math.sin(k.t * (12 + k.t * 40))) * Math.min(1, k.t * 2);
        k.body.position.set(Math.round(k.x), Math.round(k.y));
        k.flash.position.copyFrom(k.body.position);
        keep.push(k);
        continue;
      }
      k.body.destroy();
      k.flash.destroy();
      this.explodeAt(k.x, k.y, k.lv);
    }
    this.kamikaze = keep;
  }

  explodeAt(x, y, lv) {
    const Bm = CONFIG.arms.bomb;
    const R = Bm.radius[lv - 1] * this.G.run.mods.bombRadius, D = Bm.damage[lv - 1];
    this.fx.explode(x, y, lv, this.G.view);
    sfx.explode(lv >= 2);
    this.unitsIn(x - R, x + R, (u) => { if (Math.hypot(u.x - x, u.y - y) < R) this.killUnit(u, 'shot'); });
    for (const s of this.soldiers) if (!s.dead && Math.hypot(s.x - x, s.y - y) < R + s.r) s.damage(D);
    for (const e of this.beetles) if (!e.dead && Math.hypot(e.x - x, e.y - y) < R + e.r) e.damage(D);
    for (const e of this.eggs) if (e.state === 'alive' && Math.hypot(e.x - x, e.y - y) < R + e.r) e.damage(D);
    for (const c of this.cocoons) if (c.state === 'alive' && Math.hypot(c.x - x, c.y - y) < R + c.r) c.damage(D);
    for (const c of this.cages) if (c.state === 'alive' && Math.hypot(c.x - x, c.y - y) < R + c.r) c.damage(D);
  }

  // ---------------------------------------------------------------------------
  // 予告の赤い円（ゴミムシのガス）
  // ---------------------------------------------------------------------------
  updateDangers(dt) {
    const sw = this.swarm;
    const keep = [];
    for (const d of this.dangers) {
      d.t += dt;
      const p = Math.min(1, d.t / d.warn);
      d.g.clear();
      d.gl.clear();
      const blink = 0.5 + 0.5 * Math.sin(d.t * (10 + p * 20));
      d.g.circle(d.x, Math.round(d.y), d.r).fill({ color: 0xff2a1a, alpha: 0.2 + 0.22 * p * blink });
      d.gl.circle(d.x, Math.round(d.y), d.r).stroke({ width: 1, color: 0xff3a2a, alpha: 0.6 + 0.4 * blink });
      d.gl.circle(d.x, Math.round(d.y), Math.max(1, d.r * p)).stroke({ width: 1, color: 0xffb08a, alpha: 0.7 });
      if (d.t < d.warn) { keep.push(d); continue; }
      // 吹いた：円の中のアリが倒れる
      const inside = (a) => Math.hypot(a.x - d.x, (a.y - d.y) * 1.1) < d.r;
      let k = 0;
      for (const a of sw.ants) if (inside(a)) k++;
      if (k > 0) {
        this.loseAnts(k, { pick: (a) => (inside(a) ? 0 : 1) + Math.random() * 0.3, armor: true, min: 1, why: 'gas' });
        sfx.hurt();
        this.G.flash(0xff5a1a, 0.15);
      }
      const fx = this.fx;
      fx.burst(fx.glow, d.x, d.y, 18, { color: [FXC.orange, FXC.yellow, 0xffffff], speed: [30, 100], life: [0.2, 0.45], drag: 5, size: 2 });
      fx.ring(fx.glow, d.x, d.y, 4, Math.min(34, d.r + 4), 0.3, FXC.orange, 1);
      fx.blot(fx.under, d.x, d.y, Math.round(d.r * 0.8), 0x1a0806, 0.5, 1.5);
      d.g.destroy();
      d.gl.destroy();
    }
    this.dangers = keep;
  }

  // ---------------------------------------------------------------------------
  // 石・水たまり
  // ---------------------------------------------------------------------------
  addRock(ev, y) {
    const sh = this.S.props.rocks;
    const s = new Sprite(sh.anims.variant[ev.variant ?? 0]);
    anchorOf(s, sh);
    s.position.set(ev.x, Math.round(y));
    s.zIndex = y + 4;
    this.swarm.layer.addChild(s);
    const r = { x: ev.x, y, r: ev.r ?? CONFIG.rock.radii[1], s };
    this.rocks.push(r);
    this.swarm.obstacles.push(r);
  }

  addPuddle(ev, y) {
    const sh = this.S.props.puddles;
    const s = new Sprite(sh.anims.variant[ev.variant ?? 0]);
    anchorOf(s, sh);
    s.position.set(ev.x, Math.round(y));
    this.under.addChild(s);
    this.puddles.push({ x: ev.x, y, rx: ev.rx ?? 44, ry: ev.ry ?? 22, s });
  }

  updatePuddles(dt) {
    const sw = this.swarm;
    if (!this.puddles.length || sw.count <= 0) return;
    let inside = 0;
    const isIn = (a) => this.puddles.some((p) => ((a.x - p.x) / p.rx) ** 2 + ((a.y - p.y) / p.ry) ** 2 < 1);
    for (const a of sw.ants) if (isIn(a)) inside++;
    if (!inside) { this.drownAcc = 0; return; }
    this.drownAcc += inside * CONFIG.puddle.drown * dt;
    if (this.drownAcc >= 1) {
      const k = Math.floor(this.drownAcc);
      this.drownAcc -= k;
      this.loseAnts(k, { pick: (a) => (isIn(a) ? 0 : 1) + Math.random() * 0.5, burst: false, why: 'puddle' });
    }
  }

  // ---------------------------------------------------------------------------
  // 巣を落とした（残りのシロアリが0になった）
  // ---------------------------------------------------------------------------
  nestDown() {
    const n = this.nest;
    this.state = 'done';
    n.state = 'down';
    const G = this.G, fx = this.fx, run = G.run, N = CONFIG.nest;
    const secs = this.time - (n.reachedT ?? this.time);
    const stars = secs <= N.stars[0] ? 3 : secs <= N.stars[1] ? 2 : 1;
    let lost = 0;
    for (const k in this.stats.loss) lost += this.stats.loss[k];
    const flawless = lost === 0;
    const bonus = CONFIG.honey.nest + this.stage.area + stars * N.honeyPerStar + Math.floor(run.count / 10) * N.honeyPer10 + (flawless ? N.flawless : 0);
    this.honey(bonus, n.x, n.y - 40, 20);
    // 崩れる：何度も爆ぜて、土ぼこりと蜜が噴き出す
    const y = n.y - 40;
    for (let i = 0; i < 5; i++) {
      G.later(i * 0.12, () => fx.explode(n.x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, 3, G.view));
    }
    fx.burst(fx.glow, n.x, y, 40, { color: [0xffd420, 0xffb000, 0xfff0a0], speed: [40, 140], life: [0.5, 1.1], drag: 2.5, size: 2 });
    fx.burst(fx.over, n.x, y + 20, 30, { color: [0x5a4030, 0x3a2a20, 0x7a5a40], speed: [30, 110], life: [0.6, 1.2], drag: 3, size: 2 });
    G.slowmo();
    G.hitstop(0.1);
    G.view.shake(CONFIG.feel.shakeBig);
    G.flash(0xffd420, 0.3);
    sfx.explode(true);
    G.later(0.25, () => sfx.clear());
    n.spr.alpha = 0.45;
    for (const d of this.dangers) { d.g.destroy(); d.gl.destroy(); }
    this.dangers = [];
    this.swarm.speed = CONFIG.lane.speed * 0.6;   // 群れが巣へなだれ込む
    const starText = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    G.banner(t('nest_down'), 'good', `${starText}  ${t('left_count', { n: fmt(run.count) })}${flawless ? '  ' + t('flawless') : ''}`);
    this.hooks.onClear?.({ stars, kills: this.kills, left: run.count, honey: this.stageHoney, flawless });
  }

  // ---------------------------------------------------------------------------
  // 毎フレーム
  // ---------------------------------------------------------------------------
  camY() {
    return this.swarm.y - (this.screenY - 0.5) * this.G.view.H;
  }

  spawnEvents() {
    const ahead = this.camY() - this.G.view.H / 2 - 100;
    while (this.next < this.events.length && this.startY - this.events[this.next].y > ahead) {
      const ev = this.events[this.next++];
      const y = this.startY - ev.y;
      const L = CONFIG;
      let obj = null, dy = -40;
      if (ev.kind === 'horde') { obj = this.addHorde(ev, y); dy = 14; }
      else if (ev.kind === 'soldiers') {
        const n = foeCount(ev.n, this.G.run);
        for (let i = 0; i < n; i++) {
          const s = this.addSoldier(ev.x + (ev.spread ?? 0) * (i - (n - 1) / 2), y - i * L.soldier.gap, ev.hp);
          if (i === 0) { obj = s; dy = -26; }
        }
      }
      else if (ev.kind === 'egg') { obj = new Egg(this, ev, y); this.eggs.push(obj); dy = -38; }
      else if (ev.kind === 'cocoon') this.cocoons.push(new Cocoon(this, ev, y));
      else if (ev.kind === 'cage') { obj = new Cage(this, ev, y); this.cages.push(obj); dy = -42; }
      else if (ev.kind === 'board') { obj = new Panel(this, 'board', ev.x, y, L.board.width, ev.v); this.panels.push(obj); dy = -22; }
      else if (ev.kind === 'gold') this.panels.push(new Panel(this, 'gold', ev.x, y, L.gold.width, 2));
      else if (ev.kind === 'plus') {
        for (let i = 0; i < ev.n; i++) {
          const p = new Panel(this, 'plus', ev.x, y - i * L.plusLane.gap, L.plusLane.width, (ev.v ?? 1) + this.G.run.mods.plusBonus);
          this.panels.push(p);
          if (i === 0) { obj = p; dy = 18; }
        }
      }
      else if (ev.kind === 'beetle') { obj = new Beetle(this, ev, y); this.beetles.push(obj); dy = -32; }
      else if (ev.kind === 'rock') this.addRock(ev, y);
      else if (ev.kind === 'puddle') this.addPuddle(ev, y);
      else if (ev.kind === 'nest') {
        this.nest = obj = new Nest(this, ev, y);
        dy = -150;
        sfx.warn();
      }
      if (obj && ev.hint && this.hintsOn) this.addHint(obj, ev.hint, dy);
    }
  }

  cleanup() {
    const below = this.camY() + this.G.view.H / 2 + 40;
    this.hordes = this.hordes.filter((h) => {
      if (h.done) { h.destroy(); return false; }
      if (h.y + h.back > below) {
        if (h.alive > 0) this.foeDown(h.alive);   // 通り過ぎて逃げた
        h.destroy();
        return false;
      }
      return true;
    });
    this.soldiers = this.soldiers.filter((s) => {
      if (s.dead && s.corpse <= 0) { s.destroy(); return false; }
      if (!s.dead && !s.engaged && s.y > below) { this.foeDown(1); s.dead = true; s.destroy(); return false; }
      return true;
    });
    this.eggs = this.eggs.filter((e) => {
      if (e.state === 'dead') return false;
      if (e.y > below) { e.remove(); return false; }
      return true;
    });
    this.cocoons = this.cocoons.filter((c) => c.state !== 'gone');
    this.cages = this.cages.filter((c) => {
      if (c.state === 'dead' || c.state === 'gone') return false;
      if (c.y > below) { c.remove(); return false; }
      return true;
    });
    this.panels = this.panels.filter((p) => {
      if (p.gone || p.y > below) { p.destroy(); return false; }
      return true;
    });
    this.beetles = this.beetles.filter((e) => {
      if (e.dead || e.y > below) {
        if (!e.counted) { e.counted = true; this.foeDown(1); }
        e.destroy();
        return false;
      }
      return true;
    });
    this.rocks = this.rocks.filter((r) => {
      if (r.y > below + 40) {
        r.s.destroy();
        this.swarm.obstacles = this.swarm.obstacles.filter((o) => o !== r);
        return false;
      }
      return true;
    });
    this.puddles = this.puddles.filter((p) => { if (p.y > below + 40) { p.s.destroy(); return false; } return true; });
  }

  update(dt) {
    this.time += dt;
    const sw = this.swarm;
    this.spawnEvents();
    for (const h of this.hordes) h.update(dt);
    for (const s of this.soldiers) s.update(dt);
    this.buildGrid();
    if (this.state === 'run') {
      this.contacts();
      this.buildAimList();
      this.fire(dt);
      this.weapons(dt);
    }
    this.updateHeroes(dt);
    this.updateBullets(dt);
    this.updateKamikaze(dt);
    this.updateRunners(dt);
    for (const e of this.eggs) e.update(dt);
    for (const c of this.cocoons) c.update(dt);
    for (const c of this.cages) c.update(dt);
    for (const p of this.panels) p.update(dt);
    for (const e of this.beetles) if (!e.dead) e.update(dt);
    this.updateDangers(dt);
    this.updatePuddles(dt);
    this.nest?.update(dt);
    if (this.hints.length) this.updateHints(dt);
    // 巣の手前で止まる
    const stop = this.G.run.weapon?.type === 'mandible' ? CONFIG.lane.nestStopMelee : CONFIG.lane.nestStop;
    if (this.nest && this.state === 'run' && sw.y <= this.nest.y + stop) {
      sw.y = this.nest.y + stop;
      sw.speed = 0;
      this.nest.reachedT ??= this.time;
    } else if (this.nest && this.state === 'run' && sw.speed === 0) {
      sw.speed = CONFIG.lane.speed;   // 巣の前でアギトアリになった：顎が届くところまで近づく
    }
    if (this.state === 'done' && this.nest && sw.y < this.nest.y + 60) sw.speed = 0;
    this.burstT -= dt;
    this.updateFever(dt);
    // 大暴れ中は前へ速く進む（巣の前で止まっているときは止まったまま）
    if (sw.speed > 0 && this.state === 'run') sw.speed = CONFIG.lane.speed * (this.feverT > 0 ? CONFIG.fever.speedMul : 1);
    this.updateDrops(dt);
    // 撃破数は少しずつ追いかけて数え上げる
    const want = this.G.run.kills || 0;
    this.killsShown = this.killsShown ?? want;
    if (this.killsShown < want) this.killsShown = Math.min(want, this.killsShown + Math.max(1, Math.ceil((want - this.killsShown) * 0.25)));
    this.G.hud.kills(this.killsShown);
    this.cleanup();
    // 残りのシロアリが0：巣が落ちる
    if (this.state === 'run' && this.nest && this.nest.reachedT !== undefined && this.foes <= 0 && sw.count > 0) this.nestDown();
  }

  destroy() {
    for (const h of this.hordes) h.destroy();
    for (const s of this.soldiers) s.destroy();
    for (const e of this.eggs) e.remove();
    for (const c of this.cocoons) c.remove();
    for (const c of this.cages) c.remove();
    for (const p of this.panels) p.destroy();
    for (const e of this.beetles) e.destroy();
    for (const r of this.rocks) r.s.destroy();
    for (const p of this.puddles) p.s.destroy();
    for (const k of this.kamikaze) { k.body.destroy(); k.flash.destroy(); }
    for (const d of this.dangers) { d.g.destroy(); d.gl.destroy(); }
    for (const r of this.runners) r.s.destroy();
    for (const h of this.hints) h.el.remove();
    this.nest?.destroy();
    this.under.destroy({ children: true });
    this.top.destroy({ children: true });
    this.glow.destroy({ children: true });
    const sw = this.swarm;
    sw.obstacles = [];
    sw.followMul = 1;
    sw.setShape();
    this.G.hud.foes(null);
  }
}
