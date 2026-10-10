// 作り直し（v2）の1ステージ：群れが前へ進み、迫ってくるシロアリの大群・卵・繭・看板などを撃ちながら、
// 奥にある敵の巣を落とす（docs/redesign.md）。
//   ・群れのアリがそれぞれ真っ直ぐ前へ撃つ。群れが大きいほど弾が多く、横にも広く当たる
//   ・卵の山：撃ち割ると、生まれたアリが群れに加わる
//   ・変異の繭：撃ち割ると変異する（武器が変わる／Lv が上がる）
//   ・シロアリの大群：1発で1匹ずつ倒れる。群れに触れると1匹ずつ相殺
//   ・＋の道（1枚ずつ増える）・−の看板（撃つと数字が上がる）・金の×2ゲート（たまに）
//   ・ミイデラゴミムシ：赤い円で予告してから熱いガスを吹く
//   ・敵の巣：決まった耐久。撃ち落とせばクリア
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

// シロアリを横に区切って探す（弾・群れとの当たりを速く調べるため）
const BUCKET = 8;
const NB = Math.ceil((CONFIG.track.width + 120) / BUCKET);
const bucketOf = (x) => Math.max(0, Math.min(NB - 1, Math.floor((x + HALF + 60) / BUCKET)));

// =============================================================================
// シロアリの大群
// =============================================================================
class Horde {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = ev.x;
    this.y = y;            // いちばん手前の列の位置。後ろの列ほど奥（上）に並ぶ
    const H = CONFIG.horde;
    const n = Math.max(1, Math.round(ev.n * inv(lane.G.run, 'enemyPer')));
    this.n0 = n;
    const sp = H.spacing;
    const w = Math.max(sp, Math.min(ev.w ?? Math.sqrt(n) * sp * 1.3, CONFIG.track.width - 16));
    const cols = Math.max(1, Math.round(w / sp));
    const P = lane.S.props;
    this.units = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const inRow = Math.min(cols, n - r * cols);
      const soldier = i % H.soldierEvery === H.soldierEvery - 1;
      const sheet = soldier ? P.termite_soldier : P.termite_worker;
      const s = new Sprite(sheet.anims.walk[0]);
      s.anchor.set(sheet.anchor[0] / sheet.cell[0], sheet.anchor[1] / sheet.cell[1]);
      lane.swarm.layer.addChild(s);
      // 暗い地面で見えるよう、同じ絵をうすく光らせて重ねる
      const lit = new Sprite(sheet.anims.walk[0]);
      lit.anchor.copyFrom(s.anchor);
      lit.tint = H.litColor;
      lit.alpha = H.litAlpha;
      lane.glow.addChild(lit);
      this.units.push({ lit,
        ox: (c - (inRow - 1) / 2) * sp + (Math.random() - 0.5) * 3,
        oy: -r * sp * 0.9 + (Math.random() - 0.5) * 3,
        x: this.x, y: this.y, hp: soldier ? H.soldierHp : H.workerHp, soldier, s, sheet,
        ph: Math.random() * 6.28, poison: 0, poisoned: false, dead: false, horde: this,
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
    this.y += H.speed * dt;
    this.walk += (H.speed + this.lane.swarm.speed) * dt;
    for (const u of this.units) {
      if (u.dead) {
        // 倒れたシロアリは、その場に少し残って消える
        if (u.corpse > 0) {
          u.corpse -= dt;
          u.s.alpha = Math.max(0, Math.min(0.85, u.corpse / 0.5));
        }
        continue;
      }
      u.x = Math.max(-HALF + 4, Math.min(HALF - 4, this.x + u.ox + Math.sin(this.walk * 0.05 + u.ph) * H.wobble));
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
// 卵の山（撃ち割ると、生まれたアリが群れに加わる）
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
    // 卵の並び（数が多いほど山が大きい）
    const k = Math.min(12, 5 + Math.floor(this.reward / 3));
    this.eggs = [];
    for (let i = 0; i < k; i++) {
      const a = i * 2.39996, rr = 14 * Math.sqrt((i + 0.5) / k);
      this.eggs.push({ x: Math.round(Math.cos(a) * rr * 1.3), y: Math.round(Math.sin(a) * rr * 0.6) - 6 });
    }
    this.eggs.sort((p, q) => p.y - q.y);
    this.hpLabel = new PixelText(String(this.hp), 2);
    lane.top.addChild(this.hpLabel);
    // ごほうびは割る前から見えている：「+8」と小さなアリ
    this.rewardLabel = new PixelText('+' + this.reward, 2);
    this.rewardLabel.tint = 0xb8ffb0;
    lane.top.addChild(this.rewardLabel);
    const V = lane.S.ants[lane.swarm.variant] || lane.S.ants.base;
    this.icon = new Sprite(V.color[4][0]);
    this.icon.anchor.set(0.5);
    lane.top.addChild(this.icon);
    this.hurt = 0;
    this.kick = 0;
    this.t = Math.random() * 6;
    this.draw();
  }

  draw() {
    const g = this.g, x = this.x, y = Math.round(this.y);
    g.clear();
    g.ellipse(x, y + 2, 22, 8).fill({ color: 0x000000, alpha: 0.4 });
    const show = Math.max(1, Math.ceil(this.eggs.length * this.hp / this.hp0));
    const white = this.hurt > 0;
    for (let i = 0; i < this.eggs.length; i++) {
      const e = this.eggs[i];
      const ex = x + e.x, ey = y + e.y;
      if (i >= show) {   // 割れた卵：殻だけ
        g.ellipse(ex, ey + 2, 4, 2).fill({ color: 0x6a5a40 });
        continue;
      }
      g.ellipse(ex, ey, 5, 7).fill({ color: white ? 0xffffff : 0xe6d8b4 }).stroke({ width: 1, color: 0x2a2018 });
      g.ellipse(ex + 1, ey + 2, 3, 4).fill({ color: white ? 0xffffff : 0xc8b890 });
      g.rect(ex - 2, ey - 4, 2, 3).fill({ color: 0xfffaf0 });
    }
    this.hpLabel.setText(String(Math.max(1, Math.ceil(this.hp))));
    this.hpLabel.position.set(x, y + 4);
    this.rewardLabel.position.set(x + 8, y - 30);
    this.icon.position.set(x - 16, y - 28);
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d;
    this.hurt = 0.05;
    this.kick = 0.08;
    sfx.cocoonHit();
    if (Math.random() < 0.5) {
      const fx = this.lane.fx;
      fx.burst(fx.over, this.x + (Math.random() - 0.5) * 16, this.y - 8, 2, { color: [0xfffaf0, 0xe6d8b4], speed: [20, 60], life: [0.15, 0.3], drag: 5 });
    }
    if (this.hp <= 0) this.hatch();
    else this.draw();
  }

  hatch() {
    this.state = 'gone';
    const lane = this.lane, fx = lane.fx;
    fx.burst(fx.over, this.x, this.y - 4, 26, { color: [0xe6d8b4, 0xfffaf0, 0xb8a888], speed: [40, 130], life: [0.3, 0.7], drag: 4, size: 2 });
    fx.burst(fx.glow, this.x, this.y - 6, 14, { color: [0xb8ffb0, 0xffffff], speed: [30, 90], life: [0.2, 0.45], drag: 5, size: 2 });
    fx.ring(fx.glow, this.x, this.y - 4, 3, 26, 0.35, 0xb8ffb0, 0.9);
    fx.ring(fx.glow, this.x, this.y - 4, 2, 14, 0.2, 0xffffff, 0.9);
    const got = lane.gain(this.reward, { x: this.x, y: this.y - 4 }, 'egg');
    lane.G.popupNum(this.x, this.y - 22, '+' + got, 0xb8ffb0);
    lane.G.view.shake(CONFIG.feel.shakeSmall);
    sfx.hatch();
    this.remove();
  }

  update(dt) {
    if (this.state === 'passed') {
      this.fade -= dt;
      for (const s of [this.g, this.hpLabel, this.rewardLabel, this.icon]) s.alpha = Math.max(0, this.fade * 2);
      if (this.fade <= 0) this.remove();
      return;
    }
    if (this.state !== 'alive') return;
    this.t += dt;
    if (this.hurt > 0) { this.hurt -= dt; if (this.hurt <= 0) this.draw(); }
    // 当たるとゆれる・数字がはねる
    this.kick -= dt;
    this.g.position.x = this.kick > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.hpLabel.scale.set(this.kick > 0.04 ? 3 : 2);
    const gl = this.gl;
    gl.clear();
    gl.ellipse(this.x, Math.round(this.y) - 6, 22, 13).fill({ color: 0xfff0b0, alpha: 0.12 + 0.06 * Math.sin(this.t * 3) });
    const sw = this.lane.swarm;
    if (sw.y < this.y + 2) {   // 割れないまま追いついた → 素通り
      this.state = 'passed';
      this.fade = 0.4;
    }
  }

  remove() {
    if (this.state === 'dead') return;
    for (const s of [this.g, this.gl, this.hpLabel, this.rewardLabel, this.icon]) s.destroy();
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
    this.spr.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
    this.spr.position.set(this.x, Math.round(y));
    this.spr.zIndex = y;
    lane.swarm.layer.addChild(this.spr);
    this.light = new Sprite(sh.glow?.stage[0] ?? sh.anims.stage[0]);
    this.light.anchor.copyFrom(this.spr.anchor);
    this.light.position.copyFrom(this.spr.position);
    this.light.tint = MUT_COLOR[this.mut];
    lane.glow.addChild(this.light);
    // 中にいるアリの姿（2倍）と、その下の光る輪
    const vn = this.mut === 'armor' ? 'armor1' : `${this.mut}1`;
    const V = lane.S.ants[vn];
    this.ring = new Graphics();
    lane.glow.addChild(this.ring);
    this.icon = new Sprite(V.color[4][0]);
    this.icon.anchor.set(0.5);
    this.icon.scale.set(2);
    this.icon.position.set(this.x, Math.round(y) + CONFIG.cocoon.iconY);
    this.iconGlow = new Sprite(V.glow[4][0]);
    this.iconGlow.anchor.set(0.5);
    this.iconGlow.scale.set(2);
    this.iconGlow.position.copyFrom(this.icon.position);
    lane.top.addChild(this.icon);
    lane.glow.addChild(this.iconGlow);
    this.label = new PixelText(String(this.hp), 1);
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
      this.el.innerHTML = `<b>${t('mut_' + this.mut)}</b><i>${t('mut_role_' + this.mut)}</i><span class="${p.how}">${t('cocoon_' + p.how, { n: p.lv })}</span>`;
    }
    const G = this.f.G;
    const q = G.worldToCss(this.x, this.y + CONFIG.cocoon.labelY);
    const m = 46;
    this.el.style.left = Math.max(m, Math.min(G.view.cssW - m, q.x)) + 'px';
    this.el.style.top = q.y + 'px';
    if (this.state === 'alive') this.el.style.opacity = String(Math.max(0, Math.min(1, (q.y - 70) / 50)));   // 上のバーと重ならないように
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
    fly.scale.set(2);
    fly.position.copyFrom(this.icon.position);
    lane.top.addChild(fly);
    const x0 = fly.x, y0 = fly.y;
    let tt = 0;
    lane.fx.anims.push({ update: (dt) => {
      tt += dt;
      const p = Math.min(1, tt / 0.32), e = p * p;
      fly.position.set(Math.round(x0 + (sw.x - x0) * e), Math.round(y0 + (sw.y - y0) * e - Math.sin(p * Math.PI) * 26));
      if (p < 1) return true;
      fly.destroy();
      lane.fx.ring(lane.fx.glow, sw.x, sw.y, 4, 34, 0.45, mcol, 1);
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
    this.label.scale.set(this.kick > 0.04 ? 2 : 1);
    // 中のアリがふわふわ浮く
    const bob = Math.round(Math.sin(this.t * 2.4) * 2);
    this.icon.position.y = Math.round(this.y) + CONFIG.cocoon.iconY + bob;
    this.iconGlow.position.y = this.icon.position.y;
    this.ring.clear();
    this.ring.ellipse(this.x, Math.round(this.y) + CONFIG.cocoon.iconY + 16, 13, 4).stroke({ width: 1, color: MUT_COLOR[this.mut], alpha: 0.5 + 0.4 * Math.sin(this.t * 4) });
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
    this.h = kind === 'plus' ? 12 : 16;
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
    g.rect(x0, y0, this.w, this.h).fill({ color: c.fill, alpha: this.kind === 'gold' ? 0.55 : 0.4 });
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

  /** −の看板を撃った：数字が上がる */
  hit(power = 1) {
    if (this.kind !== 'board' || this.used || this.v >= this.cap) return false;
    this.hits += power;
    if (this.hits >= CONFIG.board.hitsPerStep) {
      this.hits = 0;
      this.v = Math.min(this.cap, this.v + Math.max(1, Math.round(Math.abs(this.v0) / 10)));
      if (this.v === 0) this.v = 1;
      this.bump = 0.12;
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
    this.spr.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
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
    this.lane.honey(CONFIG.honey.beetle, this.x, this.y);
    const fx = this.lane.fx;
    fx.burst(fx.glow, this.x, this.y, 18, { color: [FXC.ember, FXC.orange, 0xffffff], speed: [30, 100], life: [0.2, 0.5], drag: 5, size: 2 });
    fx.burst(fx.over, this.x, this.y, 14, { color: [0x36220c, 0x0f090b, 0x553410], speed: [30, 90], life: [0.3, 0.7], drag: 4, size: 2 });
    fx.blot(fx.under, this.x, this.y + 2, 8, 0x07050a, 0.6, 2);
    sfx.explode(false);
  }

  update(dt) {
    const lane = this.lane, sw = lane.swarm, Gs = CONFIG.gas;
    this.y += 8 * dt;
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
    const w = 22;
    this.bar.rect(px - w / 2, py - 26, w, 2).fill({ color: 0x1a0c10 });
    this.bar.rect(px - w / 2, py - 26, Math.max(0, w * this.hp / this.hp0), 2).fill({ color: 0xff5a3a });
  }

  destroy() {
    this.spr.destroy();
    this.gl.destroy();
    this.bar.destroy();
  }
}

// =============================================================================
// 敵の巣（ステージのゴール）
// =============================================================================
class Nest {
  constructor(lane, ev, y) {
    this.lane = lane;
    this.x = 0;
    this.y = y;
    const N = CONFIG.nest;
    this.hp = this.hp0 = Math.round(ev.hp * (1 + (lane.G.run.invasion || 0) * N.hpPerInvasion));
    this.appearT = lane.time;
    this.spawnT = 1.2;
    this.state = 'alive';
    const ms = lane.S.props.termite_mound;
    this.sheet = ms;
    this.spr = new Sprite(ms.anims.damage[0]);
    this.spr.anchor.set(ms.anchor[0] / ms.cell[0], ms.anchor[1] / ms.cell[1]);
    this.spr.scale.set(N.scale);
    this.spr.position.set(0, Math.round(y));
    this.spr.zIndex = y;
    lane.swarm.layer.addChild(this.spr);
    this.gl = new Sprite(ms.glow ? ms.glow.damage[0] : ms.anims.damage[0]);
    this.gl.anchor.copyFrom(this.spr.anchor);
    this.gl.scale.set(N.scale);
    this.gl.position.copyFrom(this.spr.position);
    this.gl.visible = !!ms.glow;
    lane.glow.addChild(this.gl);
    this.label = new PixelText(formatCount(this.hp), 3);
    this.label.tint = 0xffb08a;
    this.label.position.set(0, Math.round(y) - N.hitH - 8);
    lane.top.addChild(this.label);
    this.hurt = 0;
  }

  hitTest(x, y) {
    return this.state === 'alive' && Math.abs(x - this.x) < CONFIG.nest.hitW && y < this.y - 6 && y > this.y - CONFIG.nest.hitH;
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d;
    this.hurt = 0.05;
    this.kick = 0.06;
    sfx.nestHit();
    if (Math.random() < 0.3) {
      const fx = this.lane.fx;
      fx.burst(fx.over, this.x + (Math.random() - 0.5) * 60, this.y - 20 - Math.random() * 60, 2, { color: [0x7a5a40, 0x5a4030, 0xa07850], speed: [20, 70], life: [0.2, 0.45], drag: 4, size: 2 });
    }
    const r = Math.max(0, this.hp / this.hp0);
    const st = r > 0.75 ? 0 : r > 0.5 ? 1 : r > 0.25 ? 2 : 3;
    this.spr.texture = this.sheet.anims.damage[st];
    if (this.sheet.glow) this.gl.texture = this.sheet.glow.damage[st];
    this.label.setText(formatCount(Math.max(0, Math.ceil(this.hp))));
    if (this.hp <= 0) {
      this.state = 'down';
      this.lane.nestDown(this);
    }
  }

  update(dt) {
    if (this.state !== 'alive') return;
    this.spr.tint = this.hurt > 0 ? 0xffd0c0 : 0xffffff;
    this.hurt -= dt;
    this.kick = (this.kick || 0) - dt;
    const kx = this.kick > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.spr.position.x = this.gl.position.x = this.x + kx;
    this.label.scale.set(this.kick > 0.03 ? 4 : 3);
    // 群れが近づいたら、シロアリを出して守る
    const lane = this.lane;
    if (lane.swarm.y - this.y > CONFIG.lane.nestStop + 140) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const N = CONFIG.nest;
      this.spawnT = N.spawnEvery * (0.8 + Math.random() * 0.4);
      const k = 1 - Math.max(0, this.hp / this.hp0);
      const stay = this.reachedT !== undefined ? lane.time - this.reachedT : 0;
      const n = Math.round(N.spawnCount[0] + (N.spawnCount[1] - N.spawnCount[0]) * k + stay * N.escalate);
      const x = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * (HALF - 60));
      lane.addHorde({ x, n, w: 30 + n * 2 }, this.y + 30);
    }
  }

  destroy() {
    this.spr.destroy();
    this.gl.destroy();
    this.label.destroy();
  }
}

// =============================================================================
// ステージ全体
// =============================================================================
export class Lane {
  /**
   * @param G      ゲーム全体（view, sprites, swarm, fx, run …）
   * @param stage  course.js の1ステージ
   * @param hooks  { onClear({stars}), onWipe() }
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
    this.events = stage.course.events.map((e) => ({ ...e }));
    if (G.run.mods.goldEvery && !this.events.some((e) => e.kind === 'gold')) {
      const gy = Math.round(stage.course.length * 0.55), gx = (Math.random() < 0.5 ? -1 : 1) * 60;
      this.events.push({ y: gy, kind: 'gold', x: gx }, { y: gy + 100, kind: 'horde', x: gx, n: 18, w: 40 });
    }
    this.events.sort((a, b) => a.y - b.y);
    this.next = 0;
    this.startY = this.swarm.y;
    this.length = stage.course.length;
    this.hordes = [];
    this.eggs = [];
    this.cocoons = [];
    this.panels = [];
    this.beetles = [];
    this.dangers = [];
    this.rocks = [];
    this.puddles = [];
    this.bullets = [];
    this.bulletPool = {};   // 弾の絵を使い回す（作っては捨てるとスマホで引っかかる）。絵の種類ごと
    this.kamikaze = [];
    this.nest = null;
    this.state = 'run';    // run / done
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
    this.grid = Array.from({ length: NB }, () => []);
    this.aimList = [];
    this.screenY = CONFIG.lane.swarmScreenY;
    const L = CONFIG.lane;
    const sw = this.swarm;
    sw.speed = L.speed;
    sw.bounds = { min: -HALF + 6, max: HALF - 6 };
    sw.obstacles = [];
    sw.followMul = 1;
    sw.setShape({ areaPerAnt: L.areaPerAnt, maxHalfWidth: L.maxHalfWidth, maxHalfHeight: L.maxHalfHeight });
    this.barKey = '';
    this.updateBar();
    // 1-1 の最初の3回だけ、出てきた物のそばに短い説明を出す（遊びながら覚える）
    this.hints = [];
    this.hintsOn = false;
    if (stage.index === 0) {
      const tips = getSave().tips;
      this.hintsOn = (tips.lane || 0) < 3;
      tips.lane = (tips.lane || 0) + 1;
      save();
    }
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
      const gone = o.state === 'dead' || o.state === 'gone' || o.state === 'passed' || o.state === 'down' || o.used || o.dead || o.done
        || o.y > sw.y - sw.ry || h.t > 9;
      if (gone) { h.el.remove(); return false; }
      const q = this.G.worldToCss(o.x, o.y + h.dy);
      h.half ??= h.el.offsetWidth / 2 + 6;
      h.el.style.left = Math.max(h.half, Math.min(this.G.view.cssW - h.half, q.x)) + 'px';
      h.el.style.top = q.y + 'px';
      h.el.style.opacity = String(Math.max(0, Math.min(1, (q.y - 90) / 40)));   // 上のバーと重ならないように
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
    const at = opts.at;
    const pick = opts.pick || (at ? (a) => Math.hypot(a.x - at.x, a.y - at.y) : undefined);
    this.setCount(run.count - k, { pick, removedBurst: opts.burst !== false });
    return k;
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
      this.G.popupNum(p.x, p.y - 14, '+' + formatCount(got), GOOD.text);
      sfx.gateGood();
    } else if (p.v < 0) {
      const lost = this.loseAnts(Math.max(1, Math.round(-p.v * run.mods.dmgTaken)), { at: { x: sw.x, y: sw.y - sw.ry }, why: 'board' });
      this.G.popupNum(p.x, p.y - 14, '-' + formatCount(lost), BAD.text);
      sfx.gateBad();
      this.G.flash(0xff3a2a, 0.18);
    }
  }

  /** 繭が割れた → 変異 */
  mutate(mut, x, y) {
    const run = this.G.run;
    const r = applyMutation(run, mut);
    this.swarm.setVariant(variantName(run), { ...swarmLook(run), sweep: true });
    if (run.mods.mutateGain > 0) this.gain(Math.round(run.count * run.mods.mutateGain), { x, y });
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

  // ---------------------------------------------------------------------------
  // シロアリを倒す
  // ---------------------------------------------------------------------------
  buildGrid() {
    for (const b of this.grid) b.length = 0;
    for (const h of this.hordes) {
      for (const u of h.units) if (!u.dead) this.grid[bucketOf(u.x)].push(u);
    }
  }

  /** x0〜x1 の範囲にいるシロアリ */
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
    const fx = this.fx;
    h.lastDeath = this.time;
    if (cause === 'clash') {
      fx.burst(fx.over, u.x, u.y, 3, { color: [0x8a7048, 0x3a111b, 0x9a5222], speed: [20, 60], life: [0.15, 0.35], drag: 6 });
    } else if (cause === 'flee') {
      fx.burst(fx.over, u.x, u.y, 3, { color: [0xd8c0a0, 0x8a7048], speed: [20, 60], life: [0.2, 0.4], drag: 5 });
    } else {
      // 弾ける：白い煙の粒と、割れた殻
      fx.burst(fx.glow, u.x, u.y - 2, u.soldier ? 6 : 3, { color: cause === 'poison' ? [FXC.green, 0xd8ffc8] : [0xfff4e0, 0xffe0b0], speed: [15, 45], life: [0.12, 0.28], drag: 6 });
      fx.burst(fx.over, u.x, u.y, u.soldier ? 7 : 4, { color: [0xd8c0a0, 0x8a7048, 0x6a5538], speed: [25, 80], life: [0.2, 0.5], drag: 5 });
      h.shot++;
      this.kills++;
      this.G.run.kills = (this.G.run.kills || 0) + 1;
      if (this.kills % CONFIG.horde.killsPerHoney === 0) this.honey(1, u.x, u.y, 1);
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
          this.gain(k, { x: u.x, y: u.y }, 'devour');
        }
      }
    }
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
      fx.ring(fx.glow, u.x, u.y, 4, 30, 0.4, 0xffffff, 0.7);
    }
  }

  praiseCombo(i) {
    const sw = this.swarm, G = this.G;
    G.popup(sw.x, sw.y - sw.ry - 46, t('combo', { n: this.combo }), 'combo');
    sfx.combo(i);
    if (i >= 2) G.view.shake(CONFIG.feel.shakeSmall);
    if (i >= 1) this.honey(i, sw.x, sw.y - sw.ry - 30);
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
      s = new Sprite(this.T.disc[2]);
      s.anchor.set(0.5);
      s.tint = 0xffc830;
      this.glow.addChild(s);
    }
    s.alpha = 1;
    const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
    this.drops.push({ s, x, y, v, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50, t: 0 });
  }

  updateDrops(dt) {
    const run = this.G.run;
    if (this.drops.length) {
      const view = this.G.view;
      const tx = view.camX + view.W / 2 - 24, ty = view.camY - view.H / 2 + 40;   // 右上の蜜の数
      const keep = [];
      for (const d of this.drops) {
        d.t += dt;
        if (d.t < 0.25) {
          const k = Math.exp(-dt * 4);
          d.vx *= k;
          d.vy *= k;
        } else {
          const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy) || 1;
          if (dist < 12) {
            d.s.alpha = 0;
            this.dropPool.push(d.s);
            this.honeyPending -= d.v;
            sfx.honey();
            continue;
          }
          const sp = 260 + d.t * 700;
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

  /** 群れとシロアリがぶつかった：1匹ずつ相殺 */
  contacts() {
    const sw = this.swarm;
    if (sw.count <= 0) return;
    const rx = sw.rx + 3, ry = sw.ry + 3;
    let lost = 0, cx = 0, cy = 0, n = 0;
    this.unitsIn(sw.x - rx, sw.x + rx, (u) => {
      const dx = (u.x - sw.x) / rx, dy = (u.y - sw.y) / ry;
      if (dx * dx + dy * dy < 1) {
        this.killUnit(u, 'clash');
        lost += u.soldier ? 2 : 1;
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
  // 射撃
  // ---------------------------------------------------------------------------
  weaponInfo() {
    const run = this.G.run, w = run.weapon, m = run.mods, A = CONFIG.arms;
    let rate = CONFIG.shot.perAnt, dmg = CONFIG.shot.damage, kind = 'acid', pierce = 0;
    if (w?.type === 'fire') {
      kind = 'venom';
      dmg *= A.fire.dmgMul[w.lv - 1];
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
    return { rate: rate / m.fireRate, dmg: dmg * m.dmgMul, kind, lv: w?.lv ?? 0, pierce };
  }

  fire(dt) {
    const sw = this.swarm;
    if (sw.count <= 0 || !sw.ants.length) return;
    const W = this.weaponInfo();
    const want = sw.count * W.rate;
    const perSec = Math.min(want, CONFIG.shot.maxPerSec);
    const dmg = W.dmg * (want / Math.max(1e-6, perSec));   // 弾の数の上限を超えた分は、1発を強くする
    this.fireAcc += perSec * dt;
    let shots = 0;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      const a = sw.ants[Math.floor(Math.random() * sw.ants.length)];
      this.spawnBullet(a.x, a.y - 7, W, dmg);
      if (shots % 2 === 0) this.fx.spark(this.fx.glow, a.x, a.y - 8, { color: W.kind === 'venom' ? FXC.green : W.kind === 'sting' ? FXC.purple : 0xffe27a, life: 0.05, drag: 0 });
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
    return 'streak';
  }

  spawnBullet(x, y, W, dmg) {
    const T = this.T, key = this.bulletKey(W);
    const pool = (this.bulletPool[key] ||= []);
    let s = pool.pop();
    if (!s) {
      s = new Sprite(T[key]);
      s.tint = W.kind === 'venom' ? FXC.green : W.kind === 'sting' ? FXC.purple : 0xffd860;   // 蟻酸のしずく：明るい黄色の筋
      s.anchor.set(0.5, 0);
      this.glow.addChild(s);
    }
    s.alpha = 1;
    s.position.set(Math.round(x), Math.round(y));
    const range = CONFIG.shot.range * (W.kind === 'sting' ? 1.25 : 1) * this.G.run.mods.rangeMul;
    // 前にいる的へ、弾が少し曲がって集まる（群れの撃った弾が的に吸い込まれる）
    let vx = 0;
    const tg = this.aimAt(x, y, range);
    if (tg) {
      const S = CONFIG.shot, sp = S.speed * (W.kind === 'sting' ? 1.25 : 1);
      vx = Math.max(-S.aimMax, Math.min(S.aimMax, (tg.x - x) / Math.max(8, y - tg.y))) * sp;
    }
    this.bullets.push({ s, key, x, y, vx, py: y, y0: y, range, dmg, kind: W.kind, lv: W.lv, pierce: W.pierce, hit: null });
  }

  updateBullets(dt) {
    const top = this.camY() - this.G.view.H / 2 - 20;
    const sp = CONFIG.shot.speed;
    const keep = [];
    for (const b of this.bullets) {
      b.py = b.y;
      b.y -= sp * (b.kind === 'sting' ? 1.25 : 1) * dt;
      b.x += b.vx * dt;
      if (this.bulletHits(b) || b.y < top) { this.freeBullet(b); continue; }
      const left = b.range - (b.y0 - b.y);
      if (left <= 0) {   // 届く距離の終わり：しずくが散る
        if (Math.random() < 0.3) this.fx.spark(this.fx.over, b.x, b.y, { color: b.kind === 'venom' ? FXC.greenDeep : 0x8a7a50, life: 0.12, drag: 6 });
        this.freeBullet(b);
        continue;
      }
      b.s.alpha = Math.min(1, left / 50);
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
      if (dy < 8 || dy > range) return;
      const dx = Math.abs(tx - x);
      if (dx > 5 + dy * cone) return;
      const d = dy + dx * 1.5;
      if (d < bd) { bd = d; best = { x: tx, y: ty }; }
    };
    const span = 5 + range * cone;
    this.unitsIn(x - span, x + span, (u) => { consider(u.x, u.y); });
    for (const tg of this.aimList) consider(tg.x, tg.y);
    return best;
  }

  /** 大きな的の狙う点（毎フレーム作り直す） */
  buildAimList() {
    const L = this.aimList;
    L.length = 0;
    for (const e of this.eggs) if (e.state === 'alive') L.push({ x: e.x, y: e.y - 8 });
    for (const c of this.cocoons) if (c.state === 'alive') L.push({ x: c.x, y: c.y - 12 });
    for (const e of this.beetles) if (!e.dead) L.push({ x: e.x, y: e.y });
    for (const p of this.panels) if (p.kind === 'board' && !p.used && p.v < p.cap) L.push({ x: p.x, y: p.y + p.h / 2 });
    if (this.nest && this.nest.state === 'alive') L.push({ x: this.nest.x, y: this.nest.y - 50 });
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
    for (const c of this.cocoons) {
      if (c.state === 'alive' && Math.abs(b.x - c.x) < c.r && b.y < c.y + 4 && b.y > c.y - 26) {
        c.damage(b.dmg);
        this.impact(b, b.x, b.y);
        return true;
      }
    }
    for (const e of this.eggs) {
      if (e.state === 'alive' && Math.abs(b.x - e.x) < e.r && b.y < e.y + 4 && b.y > e.y - 18) {
        e.damage(b.dmg);
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
    const n = this.nest;
    if (n && n.hitTest(b.x, b.y)) {
      const mul = b.kind === 'sting' ? CONFIG.arms.bullet.bigMul : 1;
      n.damage((b.dmg * mul + (b.kind === 'venom' ? CONFIG.arms.fire.dot[b.lv - 1] * 0.25 : 0)) * this.G.run.mods.nestDmg);
      this.impact(b, b.x, b.y);
      return true;
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
    else if (b.kind === 'sting') fx.burst(fx.glow, x, y, 4, { color: [FXC.purple, 0xffffff], speed: [40, 90], life: [0.1, 0.22], drag: 8 });
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
    const x0 = sw.x - sw.rx - 10, x1 = sw.x + sw.rx + 10;
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
    for (const e of this.eggs) if (e.state === 'alive' && inRange(e.x, e.y, e.r)) { e.damage(D); any = true; }
    for (const c of this.cocoons) if (c.state === 'alive' && inRange(c.x, c.y, c.r)) { c.damage(D); any = true; }
    for (const e of this.beetles) if (!e.dead && inRange(e.x, e.y, e.r)) { e.damage(D); e.y -= A.knock[lv - 1] * 0.5; any = true; }
    if (this.nest && this.nest.state === 'alive' && inRange(this.nest.x, this.nest.y, 40)) { this.nest.damage(D * 2 * this.G.run.mods.nestDmg); any = true; }
    if (any) {
      this.biteT = A.every[lv - 1];
      this.fx.snap(sw, lv);
      sfx.snap();
    } else this.biteT = 0.06;
  }

  /** 自爆アリ：前のアリが敵へ走り、大群の中で爆発する（使うたびに群れが減る） */
  launchBombs(dt, lv) {
    this.bombT -= dt;
    if (this.bombT > 0) return;
    const Bm = CONFIG.arms.bomb, sw = this.swarm;
    const target = this.bombTarget(Bm.reach);
    if (!target) { this.bombT = 0.15; return; }
    this.bombT = Bm.every[lv - 1];
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

  /** 爆弾の狙い：大群のいちばん密なところ、なければ卵・ゴミムシ・巣 */
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
    for (const e of this.beetles) if (!e.dead && e.y < sw.y && sw.y - e.y < reach) cand.push(e);
    for (const e of this.eggs) if (e.state === 'alive' && sw.y - e.y < reach * 0.8) cand.push(e);
    if (this.nest && this.nest.state === 'alive' && sw.y - this.nest.y < reach + 60) cand.push(this.nest);
    cand.sort((p, q) => Math.hypot(p.x - sw.x, p.y - sw.y) - Math.hypot(q.x - sw.x, q.y - sw.y));
    return cand[0] || null;
  }

  updateKamikaze(dt) {
    const keep = [];
    for (const k of this.kamikaze) {
      k.t += dt;
      const ty = k.target === this.nest ? k.target.y - 30 : k.target.y;
      const tx = k.target.x;
      const d = Math.hypot(tx - k.x, ty - k.y);
      const sp = 170;
      if (d > 6 && k.t < 2.2) {
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
    for (const e of this.beetles) if (!e.dead && Math.hypot(e.x - x, e.y - y) < R + e.r) e.damage(D);
    for (const e of this.eggs) if (e.state === 'alive' && Math.hypot(e.x - x, e.y - y) < R + e.r) e.damage(D);
    for (const c of this.cocoons) if (c.state === 'alive' && Math.hypot(c.x - x, c.y - y) < R + c.r) c.damage(D);
    if (this.nest && this.nest.state === 'alive' && Math.abs(x - this.nest.x) < R + CONFIG.nest.hitW && y < this.nest.y + R) this.nest.damage(D * 2 * this.G.run.mods.nestDmg);
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
      d.g.circle(d.x, Math.round(d.y), d.r).fill({ color: 0xff2a1a, alpha: 0.18 + 0.2 * p * blink });
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
      fx.burst(fx.glow, d.x, d.y, 22, { color: [FXC.orange, FXC.yellow, 0xffffff], speed: [30, 110], life: [0.2, 0.45], drag: 5, size: 2 });
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
    s.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
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
    s.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
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
  // 巣を落とした
  // ---------------------------------------------------------------------------
  nestDown(n) {
    this.state = 'done';
    const G = this.G, fx = this.fx, run = G.run, N = CONFIG.nest;
    const secs = this.time - (n.reachedT ?? this.time);
    const stars = secs <= N.stars[0] ? 3 : secs <= N.stars[1] ? 2 : 1;
    let lost = 0;
    for (const k in this.stats.loss) lost += this.stats.loss[k];
    const flawless = lost === 0;
    const bonus = CONFIG.honey.nest + this.stage.area + stars * N.honeyPerStar + Math.floor(run.count / 20) * N.honeyPer20 + (flawless ? N.flawless : 0);
    this.honey(bonus, n.x, n.y - 50, 26);
    // 崩れる：何度も爆ぜて、土ぼこりと蜜が噴き出す
    const y = n.y - 40;
    for (let i = 0; i < 5; i++) {
      G.later(i * 0.12, () => fx.explode(n.x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60, 3, G.view));
    }
    fx.burst(fx.glow, n.x, y, 40, { color: [0xffd420, 0xffb000, 0xfff0a0], speed: [40, 160], life: [0.5, 1.1], drag: 2.5, size: 2 });
    fx.burst(fx.over, n.x, y + 20, 30, { color: [0x5a4030, 0x3a2a20, 0x7a5a40], speed: [30, 120], life: [0.6, 1.2], drag: 3, size: 2 });
    G.slowmo();
    G.view.shake(CONFIG.feel.shakeBig);
    G.flash(0xffd420, 0.3);
    sfx.explode(true);
    G.later(0.25, () => sfx.clear());
    n.spr.alpha = 0.5;
    n.label.visible = false;
    // 残ったシロアリは逃げ散る（全部倒れる）
    for (const h of this.hordes) for (const u of h.units) if (!u.dead) this.killUnit(u, 'flee');
    for (const d of this.dangers) { d.g.destroy(); d.gl.destroy(); }
    this.dangers = [];
    this.swarm.speed = CONFIG.lane.speed * 0.6;   // 群れが巣へなだれ込む
    G.hud.bossBar(null);
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
    const ahead = this.camY() - this.G.view.H / 2 - 120;
    while (this.next < this.events.length && this.startY - this.events[this.next].y > ahead) {
      const ev = this.events[this.next++];
      const y = this.startY - ev.y;
      const L = CONFIG;
      let obj = null, dy = -40;
      if (ev.kind === 'horde') { obj = this.addHorde(ev, y); dy = 16; }
      else if (ev.kind === 'egg') { obj = new Egg(this, ev, y); this.eggs.push(obj); dy = -46; }
      else if (ev.kind === 'cocoon') this.cocoons.push(new Cocoon(this, ev, y));
      else if (ev.kind === 'board') { obj = new Panel(this, 'board', ev.x, y, L.board.width, ev.v); this.panels.push(obj); dy = -26; }
      else if (ev.kind === 'gold') this.panels.push(new Panel(this, 'gold', ev.x, y, L.gold.width, 2));
      else if (ev.kind === 'plus') {
        for (let i = 0; i < ev.n; i++) {
          const p = new Panel(this, 'plus', ev.x, y - i * L.plusLane.gap, L.plusLane.width, (ev.v ?? 1) + this.G.run.mods.plusBonus);
          this.panels.push(p);
          if (i === 0) { obj = p; dy = 22; }
        }
      }
      else if (ev.kind === 'beetle') { obj = new Beetle(this, ev, y); this.beetles.push(obj); dy = -34; }
      else if (ev.kind === 'rock') this.addRock(ev, y);
      else if (ev.kind === 'puddle') this.addPuddle(ev, y);
      else if (ev.kind === 'nest') {
        this.nest = obj = new Nest(this, ev, y);
        dy = -CONFIG.nest.hitH - 40;
        sfx.warn();
      }
      if (obj && ev.hint && this.hintsOn) this.addHint(obj, ev.hint, dy);
    }
  }

  /** 上のバー：巣までの道のり → 巣が見えたら巣の耐久 */
  updateBar() {
    const hud = this.G.hud;
    let key, name, ratio;
    if (this.state === 'done') return;
    if (this.nest) {
      name = t('nest_name');
      ratio = Math.max(0, this.nest.hp / this.nest.hp0);
    } else {
      name = t('to_nest');
      ratio = Math.min(1, (this.startY - this.swarm.y) / Math.max(1, this.length - CONFIG.lane.nestStop));
    }
    key = name + Math.round(ratio * 200);
    if (key === this.barKey) return;
    this.barKey = key;
    hud.bossBar(name, ratio);
  }

  cleanup() {
    const below = this.camY() + this.G.view.H / 2 + 60;
    this.hordes = this.hordes.filter((h) => {
      if (h.done || h.y + h.back > below) { h.destroy(); return false; }
      return true;
    });
    this.eggs = this.eggs.filter((e) => {
      if (e.state === 'dead') return false;
      if (e.y > below) { e.remove(); return false; }
      return true;
    });
    this.cocoons = this.cocoons.filter((c) => c.state !== 'gone');
    this.panels = this.panels.filter((p) => {
      if (p.gone || p.y > below) { p.destroy(); return false; }
      return true;
    });
    this.beetles = this.beetles.filter((e) => { if (e.dead || e.y > below) { e.destroy(); return false; } return true; });
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
    this.buildGrid();
    if (this.state === 'run') {
      this.contacts();
      this.buildAimList();
      this.fire(dt);
      this.weapons(dt);
    }
    this.updateBullets(dt);
    this.updateKamikaze(dt);
    for (const e of this.eggs) e.update(dt);
    for (const c of this.cocoons) c.update(dt);
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
    if (this.state === 'done' && this.nest && sw.y < this.nest.y + 80) sw.speed = 0;
    this.updateBar();
    this.burstT -= dt;
    this.updateDrops(dt);
    // 撃破数は少しずつ追いかけて数え上げる
    const want = this.G.run.kills || 0;
    this.killsShown = this.killsShown ?? want;
    if (this.killsShown < want) this.killsShown = Math.min(want, this.killsShown + Math.max(1, Math.ceil((want - this.killsShown) * 0.25)));
    this.G.hud.kills(this.killsShown);
    this.cleanup();
  }

  destroy() {
    for (const h of this.hordes) h.destroy();
    for (const e of this.eggs) e.remove();
    for (const c of this.cocoons) c.remove();
    for (const p of this.panels) p.destroy();
    for (const e of this.beetles) e.destroy();
    for (const r of this.rocks) r.s.destroy();
    for (const p of this.puddles) p.s.destroy();
    for (const k of this.kamikaze) { k.body.destroy(); k.flash.destroy(); }
    for (const d of this.dangers) { d.g.destroy(); d.gl.destroy(); }
    for (const h of this.hints) h.el.remove();
    this.nest?.destroy();
    this.under.destroy({ children: true });
    this.top.destroy({ children: true });
    this.glow.destroy({ children: true });
    const sw = this.swarm;
    sw.obstacles = [];
    sw.followMul = 1;
    sw.setShape();
  }
}
