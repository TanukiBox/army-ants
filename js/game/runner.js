// 前半「走って仲間を集める」と、ボス戦（群れのまま戦う）の場。
//   ・群れは自動で前進し、射撃も自動。弾は群れの位置から真っ直ぐ前へ。
//   ・＋−ゲート：1匹でも触れたら全額。×÷ゲート：通過した匹数にだけ効く（かすり取り）。
//   ・弾がゲートに当たると数字が上がる（上限あり）。
//   ・繭：近づくまでに撃ち壊すと群れ全体が変異。壊しきれなければ素通り。
//   ・敵：シロアリの群れ（1対1で相殺）、ミイデラゴミムシ（撃ってくる）、石（ふさぐ）、水たまり（おぼれる）。
import { Container, Sprite, Graphics } from '../../vendor/pixi.min.mjs';
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';
import { textures, C as FXC } from '../core/fx.js';
import { PixelText, formatCount } from '../core/pixelfont.js';
import { applyMutation, previewMutation, variantName, swarmLook, MUT_COLOR } from './mutation.js';
import { addHoney, inv } from './meta.js';

const HALF = CONFIG.track.width / 2;
const GOOD = { fill: 0x10306a, edge: 0x3a8cff, text: 0x7ab8ff };
const BAD = { fill: 0x6a1010, edge: 0xff3a2a, text: 0xff7a68 };
const BOOST_TEXT = 0xffd060;   // 法則カードで強くなった×ゲートの数字の色

function gateGood(g) { return g.op === 'add' ? g.v > 0 : g.v > 0; }
/** ×ゲートに足される分（増幅の法則） */
function mulBoost(g, run) { return g.op === 'mul' && g.v > 0 ? run?.mods?.mulPlus ?? 0 : 0; }
function gateText(g, run) {
  if (g.op === 'add') return (g.v >= 0 ? '+' : '-') + formatCount(Math.abs(g.v));
  return (g.v > 0 ? '×' + (g.v + mulBoost(g, run)) : '÷' + Math.abs(g.v));
}

// =============================================================================
// ゲートの並び
// =============================================================================
class GateRow {
  constructor(field, ev, y) {
    this.f = field;
    this.y = y;
    this.gates = ev.gates.map((g) => ({ ...g, v0: g.v, hits: 0, touched: 0, passed: 0, bump: 0, cap: this.capOf(g, field.G.run) }));
    this.crossed = new Set();
    this.done = false;
    this.applied = new Set();
    this.gfx = new Graphics();
    this.glow = new Graphics();
    field.top.addChild(this.gfx);
    field.glow.addChild(this.glow);
    for (const g of this.gates) {
      g.label = new PixelText('', 2);
      field.top.addChild(g.label);
    }
    this.redraw();
  }

  redraw() {
    const y = Math.round(this.y), h = CONFIG.gate.height;
    this.gfx.clear();
    this.glow.clear();
    for (const g of this.gates) {
      const c = gateGood(g) ? GOOD : BAD;
      const x0 = Math.round(g.x0) + 1, w = Math.round(g.x1 - g.x0) - 2;
      this.gfx.rect(x0, y - h / 2, w, h).fill({ color: c.fill, alpha: 0.32 });
      // 板のふちは光る
      this.glow.rect(x0, y - h / 2, w, 1).fill({ color: c.edge, alpha: 0.9 });
      this.glow.rect(x0, y + h / 2 - 1, w, 1).fill({ color: c.edge, alpha: 0.45 });
      // 柱
      for (const px of [g.x0, g.x1]) {
        if (Math.abs(px) >= HALF - 1) continue;
        this.gfx.rect(Math.round(px) - 1, y - h / 2 - 4, 3, h + 6).fill({ color: 0x0a0608 });
        this.glow.rect(Math.round(px), y - h / 2 - 4, 1, 2).fill({ color: c.edge, alpha: 1 });
      }
      const run = this.f.G.run;
      g.label.setText(gateText(g, run));
      g.label.tint = mulBoost(g, run) > 0 ? BOOST_TEXT : c.text;
      g.label.pxScale = g.bump > 0 ? 3 : 2;
      g.label.scale.set(g.label.pxScale);
      g.label.position.set(Math.round((g.x0 + g.x1) / 2), y - 2 + (g.bump > 0 ? 3 : 0));
    }
  }

  gateAt(x) {
    return this.gates.find((g) => x >= g.x0 && x <= g.x1);
  }

  /** 弾が当たって数字が上がる */
  /** 撃って上げられる上限（女王の部屋の強化・法則カードで高くなる） */
  capOf(g, run) {
    const C = CONFIG.gate;
    const capMul = run?.mods?.gateCapMul ?? 1;
    if (g.op === 'add') {
      return g.v > 0 ? Math.round(g.v * C.posCapRatio * capMul) : Math.max(1, Math.round(-g.v * C.negCapRatio * capMul));
    }
    const lad = C.mulLadder;
    const i = Math.max(0, lad.indexOf(g.v));
    return lad[Math.min(lad.length - 1, i + C.mulCapSteps + (run?.mods?.gateCapSteps ?? 0))];
  }

  hit(g, power = 1) {
    if (g.op === 'add') {
      if (g.v >= g.cap) return false;
      g.hits += power;
      if (g.hits < CONFIG.gate.addHitsPerStep) return true;
      g.hits = 0;
      const step = Math.max(1, Math.round(Math.abs(g.v0) * CONFIG.gate.addStepRatio));
      g.v = Math.min(g.cap, g.v + step);
      if (g.v === 0) g.v = Math.min(g.cap, step);   // 0 は飛ばす
    } else {
      const lad = CONFIG.gate.mulLadder;
      let i = lad.indexOf(g.v);
      if (i < 0 || g.v >= g.cap) return false;
      g.hits += power;
      if (g.hits >= CONFIG.gate.mulHitsPerStep) {
        g.hits = 0;
        g.v = Math.min(g.cap, lad[Math.min(lad.length - 1, i + 1)]);
      } else return true;
    }
    g.bump = 0.08;
    this.redraw();
    return true;
  }

  update(dt) {
    let dirty = false;
    for (const g of this.gates) if (g.bump > 0) { g.bump -= dt; if (g.bump <= 0) dirty = true; }
    if (dirty) this.redraw();
    if (this.done) return;
    const sw = this.f.swarm;
    // アリが板の線を越えた瞬間を数える
    for (const a of sw.ants) {
      if (a.carpet || this.crossed.has(a)) continue;
      if (a.py >= this.y && a.y < this.y) {
        this.crossed.add(a);
        for (const g of this.gates) {
          if (a.x >= g.x0 - 3 && a.x <= g.x1 + 3) {
            g.touched++;
            if (g.op === 'add' && !this.applied.has(g)) {   // ＋−：1匹でも触れたら全額
              this.applied.add(g);
              this.f.applyAdd(g, a.x, this.y);
            }
          }
          if (a.x >= g.x0 && a.x <= g.x1) g.passed++;
        }
      }
    }
    // 群れが通り過ぎたら、×÷を通過した割合で決める
    if (sw.y + sw.ry + 6 < this.y || (sw.ants.length === 0)) {
      this.done = true;
      const total = Math.max(1, this.crossed.size);
      let graze = this.applied.size > 0;
      let mulHit = false;
      for (const g of this.gates) {
        if (g.op === 'mul' && g.passed > 0) {
          mulHit = true;
          this.f.applyMul(g, g.passed / total, (g.x0 + g.x1) / 2, this.y);
        }
      }
      if (graze && mulHit) {
        this.f.G.popup((this.gates[0].x0 + this.gates.at(-1).x1) / 2, this.y - 24, t('graze'), 'graze');
        this.f.grazeBonus(this);
      }
      if (this.crossed.size > 0) this.f.rowGain(this);
      for (const g of this.gates) g.label.alpha = 0.35;
      this.gfx.alpha = 0.5;
      this.glow.alpha = 0.3;
    }
  }

  destroy() {
    this.gfx.destroy();
    this.glow.destroy();
    for (const g of this.gates) g.label.destroy();
  }
}

// =============================================================================
// 変異の繭
// =============================================================================
class Cocoon {
  constructor(field, ev, y) {
    this.f = field;
    this.x = ev.x;
    this.y = y;
    this.mut = ev.mut;
    this.hp = this.hp0 = Math.max(4, Math.ceil(ev.hp * field.G.run.mods.cocoonHp));
    this.r = CONFIG.cocoon.radius;
    this.state = 'alive';
    const sh = field.S.props.cocoon;
    this.sheet = sh;
    this.spr = new Sprite(sh.anims.stage[0]);
    this.spr.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
    this.spr.position.set(this.x, Math.round(y));
    this.spr.zIndex = y;
    field.swarm.layer.addChild(this.spr);
    this.light = new Sprite(sh.glow?.stage[0] ?? sh.anims.stage[0]);
    this.light.anchor.copyFrom(this.spr.anchor);
    this.light.position.copyFrom(this.spr.position);
    this.light.tint = MUT_COLOR[this.mut];
    field.glow.addChild(this.light);
    // どの変異が入っているか：中にいるアリの姿（2倍の大きさ）
    const vn = this.mut === 'armor' ? 'armor1' : `${this.mut}1`;
    const V = field.S.ants[vn];
    this.icon = new Sprite(V.color[4][0]);
    this.icon.anchor.set(0.5);
    this.icon.scale.set(2);
    this.icon.position.set(this.x, Math.round(y) + CONFIG.cocoon.iconY);
    this.iconGlow = new Sprite(V.glow[4][0]);
    this.iconGlow.anchor.set(0.5);
    this.iconGlow.scale.set(2);
    this.iconGlow.position.copyFrom(this.icon.position);
    field.top.addChild(this.icon);
    field.glow.addChild(this.iconGlow);
    // 耐久の数字は繭の上に重ねる
    this.label = new PixelText(String(this.hp), 1);
    this.label.position.set(this.x, Math.round(y) + CONFIG.cocoon.hpY);
    field.top.addChild(this.label);
    // 名前と、割るとどうなるか（文字なので画面の上に重ねる）
    this.el = document.createElement('div');
    this.el.className = 'c-lbl';
    this.el.style.setProperty('--c', '#' + MUT_COLOR[this.mut].toString(16).padStart(6, '0'));
    document.getElementById('field-ui').appendChild(this.el);
    this.elKey = '';
    this.t = Math.random() * 6;
    this.place();
  }

  /** 名前の札を、繭の位置に合わせて動かす（中身は、群れの変異が変わったときだけ書きかえる） */
  place() {
    const run = this.f.G.run;
    const p = previewMutation(run, this.mut);
    const key = p.how + p.lv;
    if (key !== this.elKey) {
      this.elKey = key;
      const name = t('mut_' + this.mut);
      const role = t('mut_role_' + this.mut);
      const what = t('cocoon_' + p.how, { n: p.lv });
      this.el.innerHTML = `<b>${name}</b><i>${role}</i><span class="${p.how}">${what}</span>`;
    }
    const G = this.f.G;
    const q = G.worldToCss(this.x, this.y + CONFIG.cocoon.labelY);
    const m = 46;
    this.el.style.left = Math.max(m, Math.min(G.view.cssW - m, q.x)) + 'px';
    this.el.style.top = q.y + 'px';
  }

  damage(d) {
    if (this.state !== 'alive') return;
    this.hp -= d * this.f.G.run.mods.cocoonDmg;
    sfx.cocoonHit();
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
    sfx.cocoonBreak();
    addHoney(this.f.G.run, CONFIG.honey.cocoon);
    this.f.mutate(this.mut, this.x, this.y);
    this.remove();
  }

  update(dt) {
    if (this.state !== 'alive') return;
    this.t += dt;
    this.light.alpha = 0.55 + 0.45 * Math.sin(this.t * 4) ** 2;
    this.iconGlow.alpha = this.light.alpha;
    this.place();
    // 壊せないまま群れが追いついた → 素通り
    const sw = this.f.swarm;
    if (sw.y < this.y + 4) {
      this.state = 'passed';
      this.f.G.popup(this.x, this.y - 30, t('passed'), 'passed');
      this.fade = 0.5;
    }
  }

  remove() {
    for (const s of [this.spr, this.light, this.icon, this.iconGlow, this.label]) s.destroy();
    this.el.remove();
    this.state = 'gone';
  }

  tick(dt) {
    if (this.state === 'passed') {
      this.fade -= dt;
      for (const s of [this.spr, this.light, this.icon, this.iconGlow, this.label]) s.alpha = Math.max(0, this.fade * 2);
      this.el.style.opacity = String(Math.max(0, this.fade * 2));
      this.place();
      if (this.fade <= 0) this.remove();
    } else this.update(dt);
  }
}

// =============================================================================
// シロアリの群れ（ぶつかると1対1で相殺）
// =============================================================================
class Termites {
  constructor(field, ev, y) {
    this.f = field;
    this.x = ev.x;
    this.y = y;
    this.x0 = ev.x;
    this.ph = Math.random() * 6.28;
    // 群れが大きいときは、シロアリもそれに合わせて多い。予想より小さい群れには少し手加減する
    const cnt = field.G.run.count, E = field.stage.expected;
    const base = Math.round(ev.n * Math.max(0.35, Math.min(1, cnt / Math.max(1, E))));
    this.n = Math.round(Math.max(base, Math.round(cnt * (ev.ratio ?? 0))) * inv(field.G.run, 'enemyPer'));
    this.n0 = ev.n;
    this.poison = 0;
    this.poisonAcc = 0;
    this.sprites = [];
    this.walk = 0;
    this.label = new PixelText(String(this.n), 1);
    this.label.tint = 0xd8c0a0;
    field.top.addChild(this.label);
    this.sync();
  }

  get r() {
    const m = Math.min(this.n, CONFIG.termites.maxShown);
    return Math.sqrt((m * 70) / Math.PI) * (1 + 0.25 * Math.log10(Math.max(1, this.n / CONFIG.termites.maxShown))) + 4;
  }

  sync() {
    const want = Math.min(Math.max(0, Math.ceil(this.n)), CONFIG.termites.maxShown);
    const P = this.f.S.props;
    while (this.sprites.length > want) {
      const s = this.sprites.pop();
      this.f.fx.burst(this.f.fx.over, s.x, s.y, 4, { color: [0x8a7048, 0x6a5538, 0x9a5222], speed: [20, 60], life: [0.2, 0.45], drag: 5 });
      s.destroy();
    }
    while (this.sprites.length < want) {
      const k = this.sprites.length;
      const sheet = k % 5 === 4 ? P.termite_soldier : P.termite_worker;
      const s = new Sprite(sheet.anims.walk[0]);
      s.anchor.set(sheet.anchor[0] / sheet.cell[0], sheet.anchor[1] / sheet.cell[1]);
      s.sheet = sheet;
      s.k = k;
      s.ph = Math.random() * 8;
      this.f.swarm.layer.addChild(s);
      this.sprites.push(s);
    }
    this.label.setText(formatCount(Math.max(0, Math.ceil(this.n))));
  }

  /** k 匹倒す。clash = ぶつかって相殺したとき（捕食の法則の対象外） */
  kill(k, clash = false) {
    const before = this.n;
    this.n = Math.max(0, this.n - k);
    if (!clash) this.f.devour(before - this.n);
    if (before > 0 && this.n <= 0 && !this.paid) {
      this.paid = true;
      addHoney(this.f.G.run, CONFIG.honey.termiteGroup);
    }
    this.sync();
  }

  update(dt) {
    const sw = this.f.swarm;
    const C = CONFIG.termites;
    // 群れに向かってくる
    this.y += C.speed * dt;
    this.t = (this.t || 0) + dt;
    this.x = this.x0 + Math.sin(this.t * C.wobble + this.ph) * C.wobbleAmp;   // ゆらゆら進むだけで、追いかけてはこない
    this.x = Math.max(-HALF + 10, Math.min(HALF - 10, this.x));
    // 毒（ヒアリ）：少しずつ減る
    if (this.poison > 0) {
      const p = Math.min(this.poison, dt * this.poison / CONFIG.weapons.fire.poisonTime + dt * 2);
      this.poison -= p;
      this.poisonAcc += p;
      if (this.poisonAcc >= 1) {
        const k = Math.floor(this.poisonAcc);
        this.poisonAcc -= k;
        this.kill(k);
        this.f.fx.burst(this.f.fx.glow, this.x, this.y, 3, { color: FXC.green, speed: [10, 30], life: [0.3, 0.5], drag: 3 });
      }
    }
    this.walk += (C.speed + sw.speed) * dt;
    const R = this.r;
    const GOLD = 2.39996;
    const m = this.sprites.length;
    this.sprites.forEach((s, i) => {
      const rr = R * Math.sqrt((i + 0.5) / Math.max(m, 1)) * (m === 1 ? 0 : 1);
      const th = i * GOLD;
      const x = this.x + rr * Math.cos(th) * 1.2 + Math.sin(this.walk * 0.2 + s.ph) * 0.8;
      const y = this.y + rr * Math.sin(th) * 0.75;
      s.position.set(Math.round(x), Math.round(y));
      s.zIndex = y;
      s.texture = s.sheet.anims.walk[Math.floor(this.walk / 2.2 + s.ph) % s.sheet.anims.walk.length];
    });
    this.label.position.set(Math.round(this.x), Math.round(this.y + R * 0.75 + 14));
    // ぶつかったら1対1で相殺
    const dx = (this.x - sw.x) / (sw.rx + R * 1.2 + 2);
    const dy = (this.y - sw.y) / (sw.ry + R * 0.75 + 4);
    if (sw.count > 0 && this.n > 0 && dx * dx + dy * dy < 1) {
      const rate = C.clashRate * (1 + Math.min(this.n, sw.count) / 150);
      const lossMul = this.f.G.run.mods.clashLoss;   // 相殺の法則：こちらが失う数が少ない
      this.clashAcc = (this.clashAcc || 0) + rate * dt;
      const k = Math.min(Math.floor(this.clashAcc), Math.ceil(this.n), Math.ceil(sw.count / lossMul));
      if (k > 0) {
        this.clashAcc -= k;
        this.kill(k, true);
        this.lossAcc = (this.lossAcc || 0) + k * lossMul;
        const lose = Math.floor(this.lossAcc);
        this.lossAcc -= lose;
        const cx = (this.x + sw.x) / 2, cy = (this.y + sw.y) / 2;
        if (lose > 0) {
          if (lose >= sw.count) this.f.G.run.shortBy = Math.ceil(this.n) + 1;   // あと何匹いれば勝てたか
          this.f.loseAnts(lose, { at: { x: this.x, y: this.y }, burst: true, cancel: true, cx, cy });
        }
        sfx.cancel();
      }
    }
  }

  get dead() { return this.n <= 0; }

  destroy() {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    this.label.destroy();
  }
}

// =============================================================================
// ミイデラゴミムシ（近づくと高温のガスを撃ってくる）
// =============================================================================
class Beetle {
  constructor(field, ev, y) {
    this.f = field;
    this.x = ev.x;
    this.y = y;
    this.hp = this.hp0 = ev.hp;
    this.r = CONFIG.beetle.radius;
    this.poison = 0;
    this.sheet = field.S.props.beetle;
    const sh = this.sheet;
    this.spr = new Sprite(sh.anims.walk[0]);
    this.spr.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
    field.swarm.layer.addChild(this.spr);
    this.gl = new Sprite(sh.glow?.walk[0] ?? sh.anims.walk[0]);
    this.gl.anchor.copyFrom(this.spr.anchor);
    this.gl.visible = !!sh.glow;
    field.glow.addChild(this.gl);
    this.white = null;
    this.bar = new Graphics();
    field.top.addChild(this.bar);
    this.cool = 0.8 + Math.random();
    this.shootT = 0;
    this.walk = 0;
    this.hurtT = 0;
  }

  damage(d) {
    const was = this.hp;
    this.hp -= d;
    this.hurtT = 0.08;
    sfx.hit();
    if (this.hp <= 0 && was > 0) {
      addHoney(this.f.G.run, CONFIG.honey.beetle);
      this.f.devour(5);
      const fx = this.f.fx;
      fx.burst(fx.glow, this.x, this.y, 18, { color: [FXC.ember, FXC.orange, 0xffffff], speed: [30, 100], life: [0.2, 0.5], drag: 5, size: 2 });
      fx.burst(fx.over, this.x, this.y, 14, { color: [0x36220c, 0x0f090b, 0x553410], speed: [30, 90], life: [0.3, 0.7], drag: 4, size: 2 });
      fx.blot(fx.under, this.x, this.y + 2, 8, 0x07050a, 0.6, 2);
      sfx.explode(false);
    }
  }

  get dead() { return this.hp <= 0; }

  update(dt) {
    const sw = this.f.swarm;
    const B = CONFIG.beetle;
    this.y += 8 * dt;
    if (this.poison > 0) {
      const p = Math.min(this.poison, dt * 3);
      this.poison -= p;
      this.hp -= p;
      if (this.hp <= 0) this.damage(0.001);
    }
    const near = sw.y - this.y < B.range && this.y < sw.y - sw.ry * 0.7;
    this.cool -= dt;
    if (near && this.cool <= 0 && sw.count > 0) {
      this.cool = B.interval;
      this.shootT = 0.45;
      // 群れのいるところへ（少し先読み）
      const tx = sw.x + (sw.targetX - sw.x) * 0.4, ty = sw.y;
      this.f.enemyShot(this.x, this.y + 12, tx, ty);
    }
    this.walk += dt;
    const sh = this.sheet;
    let frame;
    if (this.shootT > 0) {
      this.shootT -= dt;
      const k = Math.min(3, Math.floor((0.45 - this.shootT) / 0.11));
      frame = sh.anims.shoot[k];
      if (sh.glow) this.gl.texture = sh.glow.shoot[k];
    } else {
      const k = Math.floor(this.walk * 6) % sh.anims.walk.length;
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
// 場（前半のコース＋ボス戦）
// =============================================================================
export class Field {
  /**
   * @param G      ゲーム全体（view, sprites, swarm, fx, run …）
   * @param stage  stages.js の1ステージ
   * @param hooks  { onCourseEnd(), onWipe() }
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
    this.events = stage.course.events.map((e) => ({ ...e })).sort((a, b) => a.y - b.y);
    this.next = 0;
    this.startY = this.swarm.y;
    this.endY = this.startY - stage.course.length;
    this.rows = [];
    this.cocoons = [];
    this.termites = [];
    this.beetles = [];
    this.rocks = [];
    this.puddles = [];
    this.bullets = [];
    this.shots = [];      // 敵の弾
    this.kamikaze = [];
    this.fireT = 0;
    this.snapT = 0;
    this.bombT = 1.0;
    this.drownAcc = 0;
    this.courseDone = false;
    this.boss = null;
    this.swarm.speed = CONFIG.runner.speed;
    this.swarm.bounds = { min: -HALF + 6, max: HALF - 6 };
    this.swarm.obstacles = [];
    this.swarm.followMul = 1;
  }

  // ---------------------------------------------------------------------------
  // 群れの数の増減（見た目つき）
  // ---------------------------------------------------------------------------
  setCount(n, opts = {}) {
    const before = this.G.run.count;
    n = Math.max(0, Math.round(n));
    this.G.run.count = n;
    this.G.run.maxCount = Math.max(this.G.run.maxCount, n);
    this.swarm.setCount(n, opts);
    if (n > before) sfx.count(n);
    if (n <= 0 && before > 0) this.hooks.onWipe?.();
  }

  /** k 匹失う。at の近くのアリから消える。armor=true なら甲殻装甲で減る数が少なくなる */
  loseAnts(k, opts = {}) {
    const run = this.G.run;
    if (opts.armor) {
      k *= (1 - CONFIG.armor.reduce[run.armor]) * run.mods.dmgTaken * inv(run, 'hitPer');
      k = Math.max(opts.min ?? 1, Math.round(k));
    }
    if (k >= run.count && run.count > 0 && !run.shortBy) run.shortBy = Math.round(k - run.count + 1);
    k = Math.min(k, run.count);
    if (k <= 0) return 0;
    const at = opts.at;
    const pick = opts.pick || (at ? (a) => Math.hypot(a.x - at.x, a.y - at.y) : undefined);
    const fx = this.fx;
    const shownBefore = this.swarm.shown;
    this.setCount(this.G.run.count - k, { pick, removedBurst: opts.burst !== false });
    // 300匹より多いときは、描いているアリは減らないので、粒だけ飛ばす
    if (shownBefore === this.swarm.shown && at && opts.burst !== false) {
      fx.burst(fx.over, opts.cx ?? at.x, opts.cy ?? at.y, Math.min(10, k), { color: [0x3a111b, 0x5e1b27, 0x150a0e], speed: [20, 70], life: [0.2, 0.5], drag: 5 });
    }
    return k;
  }

  applyAdd(g, x, y) {
    const run = this.G.run;
    if (g.v > 0) {
      const v = Math.round(g.v * run.mods.addMul);
      g.gave = v;
      this.setCount(run.count + v, { from: { x, y: y - 6 } });
      sfx.gateGood();
      this.G.popupNum(x, y - 18, '+' + formatCount(v), 0x7ab8ff);
    } else if (this.useShield(x, y)) {
      return;
    } else {
      const k = Math.min(run.count, -g.v);
      this.loseAnts(k, { at: { x, y } });
      sfx.gateBad();
      this.G.popupNum(x, y - 18, '-' + formatCount(-g.v), 0xff7a68);
    }
  }

  /** 盾の法則：−ゲート・÷ゲートを1回無効にする */
  useShield(x, y) {
    const m = this.G.run.mods;
    if (m.shields <= 0) return false;
    m.shields--;
    this.G.popup(x, y - 26, t('shielded'), 'graze');
    sfx.ui();
    return true;
  }

  /** かすりの法則：かすり取りしたとき＋ゲートの値を上乗せ */
  grazeBonus(row) {
    const b = this.G.run.mods.grazeBonus;
    if (b <= 0) return;
    let add = 0;
    for (const g of row.gates) if (g.op === 'add' && g.gave) add += g.gave * b;
    if (add >= 1) {
      this.setCount(this.G.run.count + Math.round(add), { from: { x: this.swarm.x, y: row.y } });
      this.G.popupNum(this.swarm.x, row.y - 30, '+' + formatCount(Math.round(add)), 0xffd36a);
    }
  }

  /** 群れの法則：ゲートの並びを通るたびに増える */
  rowGain(row) {
    const g = this.G.run.mods.rowGain;
    if (g > 0 && this.G.run.count > 0) this.setCount(this.G.run.count * (1 + g), { from: { x: this.swarm.x, y: row.y } });
  }

  /** 捕食の法則：倒した敵の一部が群れに加わる */
  devour(killed) {
    const p = this.G.run.mods.predation;
    if (p <= 0 || killed <= 0 || this.G.run.count <= 0) return;
    this.devourAcc = (this.devourAcc || 0) + killed * p;
    if (this.devourAcc >= 1) {
      const k = Math.floor(this.devourAcc);
      this.devourAcc -= k;
      this.setCount(this.G.run.count + k, { from: { x: this.swarm.x, y: this.swarm.y - this.swarm.ry } });
    }
  }

  applyMul(g, frac, x, y) {
    const run = this.G.run;
    const inGate = run.count * frac;
    if (g.v < 0 && this.useShield(x, y)) return;
    if (g.v > 0) {
      const add = Math.round(inGate * (g.v + run.mods.mulPlus - 1));
      if (add > 0) {
        this.setCount(run.count + add, { from: { x, y: y - 6 } });
        sfx.multiply();
        this.G.slowmo();
        this.G.flash(0x3a8cff, 0.22);
        this.G.popupNum(x, y - 18, '+' + formatCount(add), 0x7ab8ff);
      }
    } else {
      const lose = Math.round(inGate * (1 - 1 / -g.v));
      if (lose > 0) {
        this.loseAnts(lose, { at: { x, y } });
        sfx.gateBad();
        this.G.popupNum(x, y - 18, '-' + formatCount(lose), 0xff7a68);
      }
    }
  }

  /** 繭が割れた → 変異 */
  mutate(mut, x, y) {
    const run = this.G.run;
    const r = applyMutation(run, mut);
    this.swarm.setVariant(variantName(run), { ...swarmLook(run), sweep: true });
    if (run.mods.mutateGain > 0) this.setCount(run.count * (1 + run.mods.mutateGain), { from: { x, y } });
    sfx.mutate();
    this.G.flash(MUT_COLOR[mut], 0.25);
    const name = t('mut_' + r.kind) + ' ' + t('lv', { n: r.lv });
    this.G.popup(x, y - 34, t(r.switched ? 'mutate_switch' : 'mutate', { name }), 'mutate', t('mut_desc_' + r.kind));
    this.G.hud.refresh();
  }

  enemyShot(x, y, tx, ty) {
    const d = Math.hypot(tx - x, ty - y) || 1;
    const sp = CONFIG.beetle.shotSpeed * inv(this.G.run, 'shotPer');
    const s = new Sprite(this.T.glob);
    s.anchor.set(0.5);
    s.scale.set(2);         // 2倍（整数倍なのでドットはくずれない）
    s.tint = FXC.orange;
    this.glow.addChild(s);
    this.shots.push({ s, x, y, vx: (tx - x) / d * sp, vy: (ty - y) / d * sp, life: 5, trail: 0 });
    sfx.enemyShot();
  }

  // ---------------------------------------------------------------------------
  // 射撃
  // ---------------------------------------------------------------------------
  weaponInfo() {
    const w = this.G.run.weapon;
    const F = CONFIG.fire;
    let interval = F.interval, perMul = 1, dmg = F.damage, kind = 'acid';
    if (w?.type === 'fire') { kind = 'venom'; dmg = CONFIG.weapons.fire.damage[w.lv - 1]; }
    if (w?.type === 'bullet') {
      kind = 'sting';
      interval *= CONFIG.weapons.bullet.intervalMul[w.lv - 1];
      perMul = CONFIG.weapons.bullet.perVolleyMul;
      dmg = CONFIG.weapons.bullet.damage[w.lv - 1];
    }
    // 群れが大きいほど弾が強い
    dmg *= 1 + CONFIG.fire.damagePerLog10 * Math.max(0, Math.log10(Math.max(1, this.swarm.count) / 10));
    const m = this.G.run.mods;
    return { interval: interval * m.fireRate, perMul, dmg: dmg * m.dmgMul, kind, lv: w?.lv ?? 0 };
  }

  fire(dt) {
    const sw = this.swarm;
    if (sw.count <= 0) return;
    const W = this.weaponInfo();
    this.fireT += dt;
    if (this.fireT < W.interval) return;
    this.fireT = 0;
    const F = CONFIG.fire;
    let n = Math.round(F.perVolleyBase + F.perVolleyLog2 * Math.log2(Math.max(1, sw.count)));
    // 群射の法則：10匹ごとに弾+1（最大+8）
    const extra = Math.min(8, Math.floor(sw.count / 10)) * this.G.run.mods.volleyPer10;
    n = Math.max(1, Math.min(F.perVolleyMax + extra, Math.round((n + extra) * W.perMul)));
    // 弾は群れの真ん中から細い束になって前へ飛ぶ（群れを動かして、撃つ的を選ぶ）。数が多いほど束が太い
    const half = F.beamBase + F.beamPerLog10 * Math.log10(Math.max(10, sw.count));
    const front = sw.y - sw.ry * 0.5;
    for (let i = 0; i < n; i++) {
      const u = (Math.random() + Math.random() - 1);   // 真ん中ほど多い
      this.spawnBullet(sw.x + u * half, front - Math.random() * 10, W);
    }
    if (W.kind === 'sting') sfx.sting();
    else if (W.kind === 'venom') sfx.venom();
    else sfx.shoot();
  }

  spawnBullet(x, y, W) {
    const T = this.T;
    let s;
    if (W.kind === 'venom') { s = new Sprite(T.glob); s.tint = FXC.green; }
    else if (W.kind === 'sting') { s = new Sprite(T.lance); s.tint = FXC.purple; }
    else { s = new Sprite(T.dot2); s.tint = FXC.acid; }
    s.anchor.set(0.5);
    this.glow.addChild(s);
    this.bullets.push({ s, x, y, py: y, dmg: W.dmg, kind: W.kind, lv: W.lv, trail: 0,
                        pierce: W.kind === 'sting' ? this.G.run.mods.pierce : 0, hit: null });
  }

  updateBullets(dt) {
    const top = this.camY() - this.G.view.H / 2 - 20;
    const keep = [];
    for (const b of this.bullets) {
      b.py = b.y;
      b.y -= CONFIG.fire.speed * (b.kind === 'sting' ? 1.25 : 1) * dt;
      let hit = false;
      // ゲート（線を越えたとき）
      for (const r of this.rows) {
        if (r.done) continue;
        if (b.py >= r.y + CONFIG.gate.height / 2 && b.y < r.y + CONFIG.gate.height / 2) {
          const g = r.gateAt(b.x);
          if (g) {
            if (r.hit(g, this.G.run.mods.gateGrow)) sfx.gateHit();
            this.fx.spark(this.fx.glow, b.x, r.y + 6, { color: gateGood(g) ? 0x7ab8ff : 0xff7a68, life: 0.15, drag: 6 });
          }
        }
      }
      if (!hit) hit = this.bulletVsTargets(b);
      if (hit || b.y < top) { b.s.destroy(); continue; }
      b.s.position.set(Math.round(b.x), Math.round(b.y));
      if (b.kind === 'venom') {
        b.trail += dt;
        if (b.trail > 0.05) { b.trail = 0; this.fx.spark(this.fx.glow, b.x, b.y + 3, { color: FXC.greenDeep, life: 0.25, drag: 2, vy: 10 }); }
      }
      keep.push(b);
    }
    this.bullets = keep;
  }

  /** 弾と、繭・敵・石・ボス */
  bulletVsTargets(b) {
    for (const c of this.cocoons) {
      if (c.state === 'alive' && Math.abs(b.x - c.x) < c.r && b.y < c.y + 4 && b.y > c.y - 26) {
        c.damage(b.dmg);
        this.impact(b, b.x, c.y - 4, true);
        return true;
      }
    }
    const poison = (CONFIG.weapons.fire.poison[b.lv - 1] ?? 0) * this.G.run.mods.poisonMul;
    // 貫通の法則：毒針は敵を何体か貫いて飛び続ける
    const through = (target) => {
      if (b.pierce > 0) {
        b.pierce--;
        (b.hit ||= new Set()).add(target);
        return true;
      }
      return false;
    };
    for (const g of this.termites) {
      if (g.dead || b.hit?.has(g)) continue;
      const R = g.r;
      if (Math.abs(b.x - g.x) < R * 1.2 && Math.abs(b.y - g.y) < R * 0.75 + 4) {
        g.kill(b.dmg);
        if (b.kind === 'venom') g.poison += poison;
        this.impact(b, b.x, b.y, true);
        sfx.hit();
        if (through(g)) continue;
        return true;
      }
    }
    for (const e of this.beetles) {
      if (e.dead || b.hit?.has(e)) continue;
      if (Math.abs(b.x - e.x) < e.r && Math.abs(b.y - e.y) < e.r) {
        e.damage(b.dmg);
        if (b.kind === 'venom') e.poison += poison;
        this.impact(b, b.x, b.y, true);
        if (through(e)) continue;
        return true;
      }
    }
    for (const r of this.rocks) {
      if (Math.hypot(b.x - r.x, (b.y - r.y) * 1.25) < r.r) {
        this.impact(b, b.x, b.y, false);
        return true;
      }
    }
    if (this.boss && this.boss.hitTest(b.x, b.y)) {
      const mul = b.kind === 'sting' ? CONFIG.weapons.bullet.bossMul : 1;
      this.boss.damage(b.dmg * mul, b.kind === 'venom' ? poison : 0);
      this.impact(b, b.x, b.y, true);
      return true;
    }
    return false;
  }

  impact(b, x, y, strong) {
    const fx = this.fx;
    if (b.kind === 'venom') fx.burst(fx.glow, x, y, strong ? 5 : 3, { color: [FXC.green, FXC.greenDeep], speed: [15, 45], life: [0.15, 0.35], drag: 6 });
    else if (b.kind === 'sting') {
      fx.burst(fx.glow, x, y, 6, { color: [FXC.purple, 0xffffff], speed: [40, 90], life: [0.1, 0.25], drag: 8 });
      fx.ring(fx.glow, x, y, 2, 8, 0.15, FXC.purple, 0.8);
    } else fx.burst(fx.over, x, y, 2, { color: FXC.acid, speed: [10, 30], life: [0.1, 0.2], drag: 6 });
  }

  // ---------------------------------------------------------------------------
  // 武器（アギトアリの顎・自爆アリの突撃）
  // ---------------------------------------------------------------------------
  weapons(dt) {
    const w = this.G.run.weapon;
    if (!w || this.swarm.count <= 0) return;
    const sw = this.swarm;
    if (w.type === 'mandible') {
      const M = CONFIG.weapons.mandible;
      this.snapT -= dt;
      if (this.snapT > 0) return;
      const front = sw.y - sw.ry;
      const jm = this.G.run.mods.jawMul;
      const inRange = (x, y, r = 0) => y > front - M.range * jm - r && y < sw.y + 6 && Math.abs(x - sw.x) < sw.rx + r + 12;
      let any = false;
      for (const g of this.termites) {
        if (!g.dead && inRange(g.x, g.y, g.r)) {
          g.kill(Math.round(M.kills[w.lv - 1] * jm));
          g.y -= M.knockback[w.lv - 1];   // 弾き飛ばす
          any = true;
        }
      }
      for (const e of this.beetles) {
        if (!e.dead && inRange(e.x, e.y, e.r)) {
          e.damage(M.beetleDamage[w.lv - 1]);
          e.y -= M.knockback[w.lv - 1] * 0.5;
          any = true;
        }
      }
      if (this.boss && this.boss.inMelee(sw)) {
        this.boss.damage(M.bossDamage[w.lv - 1], 0);
        any = true;
      }
      if (any) {
        this.snapT = M.interval[w.lv - 1];
        this.fx.snap(sw, w.lv);
        sfx.snap();
      }
    } else if (w.type === 'bomb') {
      const Bm = CONFIG.weapons.bomb;
      this.bombT -= dt;
      if (this.bombT > 0) return;
      const target = this.bombTarget();
      if (!target) return;
      this.bombT = Bm.interval[w.lv - 1];
      const n = Math.min(Bm.ants[w.lv - 1], Math.max(0, sw.count - 1));
      if (n <= 0) return;
      const runners = sw.frontAnts(n);
      const V = this.S.ants[sw.variant];
      for (const a of runners) {
        const body = new Sprite(V.color[0][0]);
        body.anchor.set(0.5);
        const flash = new Sprite(V.white[0][0]);
        flash.anchor.set(0.5);
        flash.tint = FXC.yellow;
        this.top.addChild(body);
        this.glow.addChild(flash);
        this.kamikaze.push({ body, flash, x: a.x, y: a.y, target, t: 0, walk: 0, V, lv: w.lv });
      }
      // 使うたびに自軍が減る
      this.loseAnts(n, { pick: (a) => a.y, burst: false });
    }
  }

  bombTarget() {
    const sw = this.swarm;
    const cand = [];
    for (const g of this.termites) if (!g.dead && g.y < sw.y && sw.y - g.y < 280) cand.push(g);
    for (const e of this.beetles) if (!e.dead && e.y < sw.y && sw.y - e.y < 280) cand.push(e);
    for (const c of this.cocoons) if (c.state === 'alive' && sw.y - c.y < 260) cand.push(c);
    if (this.boss && this.boss.alive) cand.push(this.boss.target());
    if (!cand.length) return null;
    cand.sort((p, q) => Math.hypot(p.x - sw.x, p.y - sw.y) - Math.hypot(q.x - sw.x, q.y - sw.y));
    return cand[0];
  }

  updateKamikaze(dt) {
    const keep = [];
    for (const k of this.kamikaze) {
      k.t += dt;
      const tx = k.target.x, ty = k.target.y;
      const d = Math.hypot(tx - k.x, ty - k.y);
      const sp = 150;
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
    const Bm = CONFIG.weapons.bomb;
    const R = Bm.radius[lv - 1] * this.G.run.mods.bombRadius, D = Bm.damage[lv - 1];
    this.fx.explode(x, y, lv, this.G.view);
    sfx.explode(lv >= 2);
    for (const g of this.termites) if (!g.dead && Math.hypot(g.x - x, g.y - y) < R + g.r) g.kill(D);
    for (const e of this.beetles) if (!e.dead && Math.hypot(e.x - x, e.y - y) < R + e.r) e.damage(D);
    for (const c of this.cocoons) if (c.state === 'alive' && Math.hypot(c.x - x, c.y - y) < R + c.r) c.damage(D);
    if (this.boss && this.boss.alive && this.boss.hitCircle(x, y, R)) this.boss.damage(D * 2, 0);
  }

  // ---------------------------------------------------------------------------
  // 毎フレーム
  // ---------------------------------------------------------------------------
  /** 群れの位置から決めたカメラの高さ（カメラの更新より先に呼ばれても正しいように） */
  camY() {
    return this.swarm.y - (CONFIG.runner.swarmScreenY - 0.5) * this.G.view.H;
  }

  spawnEvents() {
    const view = this.G.view;
    const ahead = this.camY() - view.H / 2 - 140;
    while (this.next < this.events.length && this.startY - this.events[this.next].y > ahead) {
      const ev = this.events[this.next++];
      const y = this.startY - ev.y;
      if (ev.kind === 'gates') this.rows.push(new GateRow(this, ev, y));
      else if (ev.kind === 'cocoon') this.cocoons.push(new Cocoon(this, ev, y));
      else if (ev.kind === 'termites') this.termites.push(new Termites(this, ev, y));
      else if (ev.kind === 'beetle') this.beetles.push(new Beetle(this, ev, y));
      else if (ev.kind === 'rock') this.addRock(ev, y);
      else if (ev.kind === 'puddle') this.addPuddle(ev, y);
    }
  }

  addRock(ev, y) {
    const sh = this.S.props.rocks;
    const s = new Sprite(sh.anims.variant[ev.variant ?? 0]);
    s.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
    s.position.set(ev.x, Math.round(y));
    s.zIndex = y + 4;
    this.swarm.layer.addChild(s);
    const r = { x: ev.x, y, r: ev.r, s };
    this.rocks.push(r);
    this.swarm.obstacles.push(r);
  }

  addPuddle(ev, y) {
    const sh = this.S.props.puddles;
    const s = new Sprite(sh.anims.variant[ev.variant ?? 0]);
    s.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
    s.position.set(ev.x, Math.round(y));
    this.under.addChild(s);
    this.puddles.push({ x: ev.x, y, rx: ev.rx, ry: ev.ry, s });
  }

  updatePuddles(dt) {
    const sw = this.swarm;
    if (!this.puddles.length || sw.count <= 0) return;
    let inside = 0, shown = 0;
    const isIn = (a) => this.puddles.some((p) => ((a.x - p.x) / p.rx) ** 2 + ((a.y - p.y) / p.ry) ** 2 < 1);
    for (const a of sw.ants) {
      if (a.carpet) continue;
      shown++;
      if (isIn(a)) {
        inside++;
        if (Math.random() < dt * 3) this.fx.spark(this.fx.over, a.x + (Math.random() - 0.5) * 4, a.y, { color: 0x3e6680, life: 0.4, drag: 1, vy: -6 });
      }
    }
    if (!inside) { this.drownAcc = 0; return; }
    this.drownAcc += sw.count * (inside / shown) * CONFIG.puddle.drown * dt;
    if (this.drownAcc >= 1) {
      const k = Math.floor(this.drownAcc);
      this.drownAcc -= k;
      this.loseAnts(k, { pick: (a) => (isIn(a) ? 0 : 1) + Math.random() * 0.5, burst: false });
    }
  }

  updateShots(dt) {
    const sw = this.swarm;
    const keep = [];
    for (const p of this.shots) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.trail += dt;
      if (p.trail > 0.04) { p.trail = 0; this.fx.spark(this.fx.glow, p.x, p.y, { color: FXC.orange, life: 0.25, drag: 3 }); }
      p.s.position.set(Math.round(p.x), Math.round(p.y));
      const dx = (p.x - sw.x) / (sw.rx + 4), dy = (p.y - sw.y) / (sw.ry + 6);
      if (sw.count > 0 && dx * dx + dy * dy < 1) {
        const B = CONFIG.beetle;
        const k = Math.max(B.killsMin, Math.round(sw.count * B.kills));
        this.loseAnts(k, { at: { x: p.x, y: p.y }, armor: true, min: 1 });
        this.fx.burst(this.fx.glow, p.x, p.y, 10, { color: [FXC.orange, FXC.yellow, 0xffffff], speed: [20, 70], life: [0.15, 0.4], drag: 5 });
        sfx.hurt();
        p.s.destroy();
        continue;
      }
      if (p.life <= 0) { p.s.destroy(); continue; }
      keep.push(p);
    }
    this.shots = keep;
  }

  cleanup() {
    const view = this.G.view;
    const below = this.camY() + view.H / 2 + 80;
    this.rows = this.rows.filter((r) => { if (r.y > below + 40) { r.destroy(); return false; } return true; });
    this.cocoons = this.cocoons.filter((c) => c.state !== 'gone');
    this.termites = this.termites.filter((g) => {
      if (g.dead || g.y > below + 60) { g.destroy(); return false; }
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
    this.spawnEvents();
    this.fire(dt);
    this.weapons(dt);
    this.updateBullets(dt);
    this.updateKamikaze(dt);
    for (const r of this.rows) r.update(dt);
    for (const c of this.cocoons) c.tick(dt);
    for (const g of this.termites) if (!g.dead) g.update(dt);
    for (const e of this.beetles) if (!e.dead) e.update(dt);
    this.updateShots(dt);
    this.updatePuddles(dt);
    this.boss?.update(dt);
    this.cleanup();
    if (!this.courseDone && this.swarm.y < this.endY) {
      this.courseDone = true;
      this.hooks.onCourseEnd?.();
    }
  }

  destroy() {
    for (const r of this.rows) r.destroy();
    for (const c of this.cocoons) if (c.state !== 'gone') c.remove();
    for (const g of this.termites) g.destroy();
    for (const e of this.beetles) e.destroy();
    for (const r of this.rocks) r.s.destroy();
    for (const p of this.puddles) p.s.destroy();
    for (const b of this.bullets) b.s.destroy();
    for (const p of this.shots) p.s.destroy();
    for (const k of this.kamikaze) { k.body.destroy(); k.flash.destroy(); }
    this.boss?.destroy();
    this.under.destroy({ children: true });
    this.top.destroy({ children: true });
    this.glow.destroy({ children: true });
    this.swarm.obstacles = [];
    this.swarm.followMul = 1;
  }
}
