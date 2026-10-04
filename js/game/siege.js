// 後半「攻城」：画面下の自分の巣から、指で狙った方向へアリを連続で送り出す。
// 送れる数は前半で集めた数。途中の動くゲートを通ると数が増える。
// 敵の巣に当たったアリは消える（使い切り）。巣の耐久を0にすればステージクリア。
// 落としたとき残っていたアリ（巣にいる分＋まだ走っている分）は次のステージへ持ち越す。
import { Container, Sprite, Graphics } from '../../vendor/pixi.min.mjs';
import { CONFIG } from './config.js';
import { t, fmt } from './i18n.js';
import { getSave, save } from './save.js';
import { addHoney, inv } from './meta.js';
import { sfx } from './audio.js';
import { C as FXC, textures } from '../core/fx.js';
import { PixelText, formatCount } from '../core/pixelfont.js';

const HALF = CONFIG.track.width / 2;
const GOOD = { fill: 0x10306a, edge: 0x3a8cff, text: 0x7ab8ff };
const BAD = { fill: 0x6a1010, edge: 0xff3a2a, text: 0xff7a68 };

export class Siege {
  /**
   * @param hooks { onClear(survivors), onFail(remainingHp) }
   */
  constructor(G, stage, hooks) {
    this.G = G;
    this.S = G.sprites;
    this.stage = stage;
    this.hooks = hooks;
    this.cfg = stage.siege;
    const view = G.view;
    this.layer = new Container();
    this.layer.sortableChildren = true;
    this.glow = new Container();
    this.top = new Container();
    G.layers.mid.addChild(this.layer);
    G.layers.glow.addChild(this.glow);
    G.layers.top.addChild(this.top);
    // 場所：カメラは動かさない。上に敵の巣、下に自分の巣
    this.baseY = 0;
    view.camX = 0;
    view.camY = this.baseY;
    const H = view.H;
    this.moundY = this.baseY - H / 2 + 165;
    this.nestY = this.baseY + H / 2 - 92;
    this.reserve = G.run.count;
    this.start = G.run.count;
    // 巣の耐久：ステージで決めた値。ただし群れが大きいときは、それに合わせて固くなる
    // 1-1 は練習：少しやわらかい
    const ratio = (stage.index === 0 ? 0.75 : (CONFIG.siege.hpCountRatio[stage.area] ?? CONFIG.siege.hpCountRatio.at(-1)))
      + (G.run.invasion || 0) * CONFIG.invasion.nestPer;
    this.hp = this.hp0 = Math.max(this.cfg.hp, Math.round(this.reserve * ratio));
    this.units = [];
    this.defenders = [];
    this.aim = 0;
    this.time = 0;
    this.emitAcc = 0;
    this.defT = 0.8;
    // はじめは説明を出して待つ。画面を触ったら（キーなら ← → か スペース）送り出しが始まる
    this.state = 'intro';
    this.unitValue = Math.max(1, Math.ceil(this.reserve / (CONFIG.siege.rate * CONFIG.siege.drainSeconds)));
    this.T = textures();
    this.variant = G.swarm.variant;
    this.look = { glowScale: G.swarm.glowScale };

    // 敵の巣
    const ms = this.S.props.termite_mound;
    this.moundSheet = ms;
    this.mound = new Sprite(ms.anims.damage[0]);
    this.mound.anchor.set(ms.anchor[0] / ms.cell[0], ms.anchor[1] / ms.cell[1]);
    this.mound.position.set(0, Math.round(this.moundY));
    this.mound.zIndex = this.moundY;
    this.layer.addChild(this.mound);
    this.moundGlow = new Sprite(ms.glow ? ms.glow.damage[0] : ms.anims.damage[0]);
    this.moundGlow.anchor.copyFrom(this.mound.anchor);
    this.moundGlow.position.copyFrom(this.mound.position);
    this.moundGlow.visible = !!ms.glow;
    this.glow.addChild(this.moundGlow);
    this.hpLabel = new PixelText(formatCount(this.hp), 2);
    this.hpLabel.tint = 0xffb08a;
    this.hpLabel.position.set(0, Math.round(this.moundY) - 100);
    this.top.addChild(this.hpLabel);
    this.hpBar = new Graphics();
    this.top.addChild(this.hpBar);

    // 自分の巣
    const ns = this.S.props.player_nest;
    this.nest = new Sprite(ns.anims.idle[0]);
    this.nest.anchor.set(ns.anchor[0] / ns.cell[0], ns.anchor[1] / ns.cell[1]);
    this.nest.position.set(0, Math.round(this.nestY));
    this.nest.zIndex = this.nestY - 40;
    this.layer.addChild(this.nest);
    if (ns.glow) {
      const g = new Sprite(ns.glow.idle[0]);
      g.anchor.copyFrom(this.nest.anchor);
      g.position.copyFrom(this.nest.position);
      this.glow.addChild(g);
    }
    this.resLabel = new PixelText(formatCount(this.reserve), 2);
    this.resLabel.position.set(0, Math.round(this.nestY) + 40);
    this.top.addChild(this.resLabel);

    // 狙いの点線
    this.aimG = new Graphics();
    this.glow.addChild(this.aimG);

    // 動くゲート
    this.gates = this.cfg.gates.map((g) => {
      const gfx = new Graphics();
      const gl = new Graphics();
      const label = new PixelText('×' + g.m, 2);
      label.tint = GOOD.text;
      this.top.addChild(gfx, label);
      this.glow.addChild(gl);
      const m = g.m > 0 ? g.m + G.run.mods.siegeMulPlus : g.m;   // 増援の法則（×ゲートだけ）
      label.setText(m > 0 ? '×' + m : '÷' + (-m));
      label.tint = m > 0 ? GOOD.text : BAD.text;
      return { ...g, m, y: this.moundY + 60 + g.t * (this.nestY - this.moundY - 120), x: 0, gfx, gl, label };
    });

    // 道をふさぐ石：当たったアリは消える
    const rs = this.S.props.rocks;
    this.rocks = (this.cfg.rocks || []).map((r) => {
      const y = this.moundY + 60 + r.t * (this.nestY - this.moundY - 120);
      const s = new Sprite(rs.anims.variant[r.variant]);
      s.anchor.set(rs.anchor[0] / rs.cell[0], rs.anchor[1] / rs.cell[1]);
      s.position.set(r.x, Math.round(y));
      s.zIndex = y + 4;
      this.layer.addChild(s);
      return { x: r.x, y, r: CONFIG.rock.radii[r.variant] };
    });
    // 反撃隊の大きさ：巣の耐久に合わせる（侵攻度で多く）
    this.defN = Math.max(3, Math.round(this.hp0 * CONFIG.siege.defenderRatio * inv(G.run, 'enemyPer')));
    // 指で狙う（最初に触ったときに送り出しが始まる）
    G.input.onPoint = (cx, cy) => {
      const p = G.toWorld(cx, cy);
      const a = Math.atan2(p.x, this.nestY - 20 - p.y);
      const m = CONFIG.siege.aimMax * Math.PI / 180;
      this.aim = Math.max(-m, Math.min(m, a));
      if (this.state === 'intro') this.begin();
    };
    this.buildHelp();
  }

  // ---------------------------------------------------------------------------
  // 説明（画面の上に文字で出す）
  // ---------------------------------------------------------------------------
  buildHelp() {
    const ui = document.getElementById('siege-ui');
    ui.innerHTML = '';
    ui.classList.remove('hidden');
    const mk = (cls, html) => {
      const e = document.createElement('div');
      e.className = cls;
      e.innerHTML = html;
      ui.appendChild(e);
      return e;
    };
    // ずっと出しておく名前：上の数字と下の数字が何か
    this.lblNest = mk('s-lbl nest', t('siege_lbl_nest'));
    this.lblRes = mk('s-lbl res', t('siege_lbl_reserve'));
    // 始まる前だけ出すもの
    this.lblGates = this.gates.map((g) => mk('s-lbl gate intro' + (g.m < 0 ? ' bad' : ''),
      g.m > 0 ? t('siege_lbl_gate', { m: g.m }) : t('siege_lbl_bad', { m: -g.m })));
    const tips = getSave().tips || (getSave().tips = {});
    const full = (tips.siege || 0) < 3;    // 最初の3回はくわしく
    tips.siege = (tips.siege || 0) + 1;
    save();
    const rules = full
      ? `<ol><li>${t('siege_rule1')}</li><li>${t('siege_rule2')}</li><li>${t('siege_rule5')}</li><li>${t('siege_rule6')}</li><li>${t('siege_rule3')}</li></ol>`
      : '';
    this.card = mk('s-card intro' + (full ? '' : ' short'),
      `<b>${t('siege_title')}</b><div class="army">${t('siege_army', { n: fmt(this.start), hp: fmt(this.hp0) })}</div>${rules}`);
    this.touch = mk('s-touch intro', `<div class="finger"></div><span>${t('siege_touch')}</span>`);
    this.placeHelp();
  }

  placeHelp() {
    const G = this.G;
    const at = (el, x, y) => {
      const p = G.worldToCss(x, y);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    };
    at(this.lblNest, 0, this.moundY - 88);
    at(this.lblRes, 0, this.nestY + 44);
    this.gates.forEach((g, i) => at(this.lblGates[i], g.x, g.y - 24));
    at(this.touch, 0, this.nestY - 52);
  }

  begin() {
    this.state = 'go';
    for (const el of document.querySelectorAll('#siege-ui .intro')) el.classList.add('gone');
  }

  emit(dt) {
    if (this.reserve <= 0) return;
    this.emitAcc += CONFIG.siege.rate * dt;
    while (this.emitAcc >= 1 && this.reserve > 0) {
      this.emitAcc -= 1;
      const v = Math.min(this.unitValue, this.reserve);
      this.reserve -= v;
      const a = this.aim + (Math.random() - 0.5) * 0.07;
      this.spawnUnit(Math.sin(a) * 6, this.nestY - 26, a, v, null);
      sfx.send();
    }
  }

  spawnUnit(x, y, ang, v, passed) {
    if (this.units.length >= CONFIG.siege.maxUnits) return false;
    const V = this.S.ants[this.variant] || this.S.ants.base;
    const spr = new Sprite(V.color[0][0]);
    spr.anchor.set(0.5);
    const gl = new Sprite(V.glow[0][0]);
    gl.anchor.set(0.5);
    gl.alpha = this.look.glowScale;
    this.layer.addChild(spr);
    this.glow.addChild(gl);
    const sp = CONFIG.siege.unitSpeed * (0.94 + Math.random() * 0.12);
    this.units.push({ x, y, vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp, v, spr, gl, V,
                      passed: new Set(passed || []), walk: Math.random() * 10 });
    return true;
  }

  removeUnit(u) {
    u.spr.destroy();
    u.gl.destroy();
    u.dead = true;
  }

  updateGates(dt) {
    for (const g of this.gates) {
      const span = HALF - g.w / 2 - 8;
      g.x = Math.sin(this.time * g.speed + g.phase) * span;
      const x0 = Math.round(g.x - g.w / 2), y = Math.round(g.y), h = CONFIG.gate.height;
      const c = g.m > 0 ? GOOD : BAD;
      g.gfx.clear();
      g.gl.clear();
      g.gfx.rect(x0, y - h / 2, g.w, h).fill({ color: c.fill, alpha: 0.35 });
      g.gfx.rect(x0 - 2, y - h / 2 - 3, 3, h + 6).fill({ color: 0x0a0608 });
      g.gfx.rect(x0 + g.w - 1, y - h / 2 - 3, 3, h + 6).fill({ color: 0x0a0608 });
      g.gl.rect(x0, y - h / 2, g.w, 1).fill({ color: c.edge, alpha: 0.9 });
      g.gl.rect(x0, y + h / 2 - 1, g.w, 1).fill({ color: c.edge, alpha: 0.45 });
      g.label.position.set(Math.round(g.x), y - 2);
    }
  }

  updateUnits(dt) {
    const keep = [];
    const mr = CONFIG.siege.moundRadius;
    const topGate = this.gates.reduce((m, g) => Math.min(m, g.y), this.nestY);
    for (const u of this.units) {
      const py = u.y;
      // 敵の巣の方へゆるやかに曲がる（ゲートの列を抜けたら強く）
      {
        const want = Math.atan2(0 - u.x, -((this.moundY - 20) - u.y));
        let ang = Math.atan2(u.vx, -u.vy);
        let d = want - ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const k = u.y < topGate - 10 ? CONFIG.siege.homing : CONFIG.siege.homingLow;
        ang += Math.max(-1, Math.min(1, d)) * k * dt;
        const sp = Math.hypot(u.vx, u.vy);
        u.vx = Math.sin(ang) * sp;
        u.vy = -Math.cos(ang) * sp;
      }
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      // 道のはしで跳ね返る（画面の外へ出ていかない）
      if (Math.abs(u.x) > HALF - 4) {
        u.x = Math.sign(u.x) * (HALF - 4);
        u.vx = -u.vx;
      }
      // 動くゲートを通ると増える
      for (let gi = 0; gi < this.gates.length; gi++) {
        const g = this.gates[gi];
        if (u.passed.has(gi)) continue;
        if (py >= g.y && u.y < g.y && Math.abs(u.x - g.x) <= g.w / 2) {
          u.passed.add(gi);
          if (g.m < 0) {   // 赤い÷ゲート：半分になる
            u.v = u.v > 1 ? Math.floor(u.v / -g.m) : (Math.random() < 0.5 ? 0 : 1);
            this.G.fx.spark(this.G.fx.glow, u.x, g.y, { color: BAD.edge, life: 0.3, drag: 3, vy: -20 });
            continue;
          }
          let made = 0;
          for (let k = 1; k < g.m; k++) {
            const ang = Math.atan2(u.vx, -u.vy) + (Math.random() - 0.5) * 0.12;
            if (this.spawnUnit(u.x + (k % 2 ? 5 : -5) * Math.ceil(k / 2), u.y - 2, ang, u.v, u.passed)) made++;
          }
          if (made < g.m - 1) u.v *= (g.m - made);   // 粒が多すぎるときは、1粒の数を増やす
          if (Math.random() < 0.3) sfx.count(this.reserve + this.fieldTotal());
          this.G.fx.spark(this.G.fx.glow, u.x, g.y, { color: GOOD.edge, life: 0.3, drag: 3, vy: -20 });
        }
      }
      // シロアリの守備隊とぶつかると1対1で相殺
      for (const d of this.defenders) {
        if (d.n <= 0) continue;
        if (Math.hypot(u.x - d.x, (u.y - d.y) * 1.3) < d.r + 3) {
          const k = Math.min(u.v, d.n);
          u.v -= k;
          d.kill(k);
          this.G.fx.burst(this.G.fx.over, u.x, u.y, 3, { color: [0x8a7048, 0x3a111b], speed: [20, 50], life: [0.15, 0.35], drag: 5 });
          sfx.cancel();
          if (u.v <= 0) break;
        }
      }
      if (u.v <= 0) { this.removeUnit(u); continue; }
      // 石に当たると消える
      if (this.rocks.some((r) => Math.hypot(u.x - r.x, (u.y - r.y) * 1.25) < r.r)) {
        this.G.fx.burst(this.G.fx.over, u.x, u.y, 3, { color: [0x3a111b, 0x45434e], speed: [20, 50], life: [0.15, 0.3], drag: 5 });
        this.removeUnit(u);
        continue;
      }
      // 敵の巣に当たる
      if (this.hp > 0 && Math.hypot(u.x, (u.y - (this.moundY - 20)) * 1.15) < mr) {
        this.hit(u);
        this.removeUnit(u);
        continue;
      }
      // 画面の外へ出たら失う
      if (u.y < this.moundY - 150 || Math.abs(u.x) > HALF + 30) { this.removeUnit(u); continue; }
      u.walk += CONFIG.siege.unitSpeed * dt;
      const dir = ((Math.round(Math.atan2(u.vx, -u.vy) / (Math.PI / 4)) % 8) + 8) % 8;
      const f = Math.floor(u.walk / 2.4) % 8;
      u.spr.texture = u.V.color[dir][f];
      u.gl.texture = u.V.glow[dir][f];
      const px = Math.round(u.x), pyy = Math.round(u.y);
      u.spr.position.set(px, pyy);
      u.gl.position.set(px, pyy);
      u.spr.zIndex = pyy;
      keep.push(u);
    }
    this.units = keep;
  }

  hit(u) {
    this.hp = Math.max(0, this.hp - u.v * this.G.run.mods.siegeDmg);   // 突撃の法則
    sfx.nestHit();
    const fx = this.G.fx;
    fx.burst(fx.over, u.x, u.y, 3, { color: [0x5e432c, 0x765638, 0x3a111b], speed: [20, 60], life: [0.2, 0.5], drag: 5 });
    if (Math.random() < 0.3) fx.spark(fx.glow, u.x, u.y, { color: FXC.ember, life: 0.3, drag: 4, vy: -20 });
    const r = this.hp / this.hp0;
    const st = r > 0.66 ? 0 : r > 0.33 ? 1 : r > 0 ? 2 : 3;
    this.mound.texture = this.moundSheet.anims.damage[st];
    if (this.moundSheet.glow) this.moundGlow.texture = this.moundSheet.glow.damage[st];
    if (this.hp <= 0) this.win();
  }

  win() {
    this.state = 'won';
    addHoney(this.G.run, CONFIG.honey.nest + this.stage.area);
    this.endT = 1.6;
    const fx = this.G.fx, y = this.moundY - 30;
    for (let i = 0; i < 4; i++) this.G.later(i * 0.14, () => fx.explode((Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, 3, this.G.view));
    sfx.explode(true);
    this.G.view.shake(CONFIG.feel.shakeBig);
    this.G.flash(0xffd420, 0.3);
    this.G.banner(t('nest_down'), 'good');
    this.hpLabel.visible = false;
    this.lblNest.classList.add('gone');
  }

  fieldTotal() {
    let n = 0;
    for (const u of this.units) n += u.v;
    return n;
  }

  /** シロアリの反撃隊：巣から出て、こちらの巣へ攻めてくる（アリをぶつけて止める） */
  spawnDefenders() {
    if (this.hp <= 0 || this.state !== 'go') return;
    this.defT -= this.dtLast;
    if (this.defT > 0) return;
    this.defT = CONFIG.siege.defenderEvery * (0.75 + Math.random() * 0.5);
    const x = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * (HALF - 70));
    this.defenders.push(new Defenders(this, x, this.moundY + 30, this.defN));
  }

  /** 反撃隊がこちらの巣に着いた：まだ出ていないアリが食べられる */
  raid(d) {
    const k = Math.min(this.reserve, Math.ceil(d.n));
    if (k > 0) {
      this.reserve -= k;
      this.G.flash(0xff2020, 0.22);
      this.G.popupNum(0, this.nestY - 50, '-' + formatCount(k), 0xff7a68);
      sfx.hurt();
      this.G.fx.burst(this.G.fx.over, d.x, d.y, 12, { color: [0x8a7048, 0x3a111b, 0x5e1b27], speed: [30, 90], life: [0.3, 0.6], drag: 4 });
    }
  }

  update(dt) {
    this.dtLast = dt;
    this.time += dt;
    const kd = this.G.input.keyDir();
    if (kd) {
      const m = CONFIG.siege.aimMax * Math.PI / 180;
      this.aim = Math.max(-m, Math.min(m, this.aim + kd * CONFIG.siege.keyAim * Math.PI / 180 * dt));
    }
    this.updateGates(dt);
    if (this.state === 'intro') {
      if (kd || this.G.input.keys.has(' ') || this.G.input.keys.has('enter')) this.begin();
    } else if (this.state === 'go') {
      this.emit(dt);
      this.spawnDefenders();
    }
    this.updateUnits(dt);
    for (const d of this.defenders) d.update(dt);
    this.defenders = this.defenders.filter((d) => {
      if (d.n > 0 && d.y > this.nestY - 34) { this.raid(d); d.n = 0; }
      if (d.n <= 0) { d.destroy(); return false; }
      return true;
    });
    // 表示
    this.resLabel.setText(formatCount(this.reserve));
    this.hpLabel.setText(formatCount(this.hp));
    const w = 120, x0 = -w / 2, y = Math.round(this.moundY) - 96;
    this.hpBar.clear();
    if (this.hp > 0) {
      this.hpBar.rect(x0 - 1, y - 1, w + 2, 5).fill({ color: 0x050304 });
      this.hpBar.rect(x0, y, w * this.hp / this.hp0, 3).fill({ color: 0xff5a3a });
    }
    // 狙いの点線
    this.aimG.clear();
    if (this.state !== 'won' && this.reserve > 0) {
      const blink = this.state === 'intro' ? 0.5 + 0.5 * Math.abs(Math.sin(this.time * 4)) : 0.55;
      for (let i = 1; i <= 9; i++) {
        const d = 18 + i * 13;
        const x = Math.round(Math.sin(this.aim) * d), yy = Math.round(this.nestY - 24 - Math.cos(this.aim) * d);
        this.aimG.rect(x, yy, 2, 2).fill({ color: 0xff6a5a, alpha: blink * (1 - i / 11) });
      }
    }
    this.placeHelp();
    // 終わり
    if (this.state === 'won') {
      this.endT -= dt;
      if (this.endT <= 0) {
        this.state = 'done';
        // 攻城で増えた分は次へ持ち越さない。ゲートで増やしても、巣の耐久の半分は必ず失う
        const cap = Math.max(Math.ceil(this.start * 0.1), this.start - Math.round(this.hp0 * CONFIG.siege.minCostRatio));
        this.hooks.onClear(Math.min(cap, this.reserve + this.fieldTotal()));
      }
    } else if (this.state === 'go' && this.reserve <= 0 && this.units.length === 0) {
      this.state = 'done';
      this.hooks.onFail(Math.ceil(this.hp / this.G.run.mods.siegeDmg));
    }
  }

  destroy() {
    this.G.input.onPoint = null;
    const ui = document.getElementById('siege-ui');
    ui.innerHTML = '';
    ui.classList.add('hidden');
    for (const u of this.units) this.removeUnit(u);
    for (const d of this.defenders) d.destroy();
    this.layer.destroy({ children: true });
    this.glow.destroy({ children: true });
    this.top.destroy({ children: true });
  }
}

/** 敵の巣から出てくるシロアリの守備隊 */
class Defenders {
  constructor(siege, x, y, n) {
    this.sg = siege;
    this.x = x;
    this.y = y;
    this.n = n;
    this.sprites = [];
    this.walk = 0;
    this.sync();
  }

  get r() { return Math.sqrt((Math.min(this.n, 30) * 70) / Math.PI) + 4; }

  sync() {
    const want = Math.min(Math.ceil(this.n), 30);
    const P = this.sg.S.props;
    while (this.sprites.length > want) this.sprites.pop().destroy();
    while (this.sprites.length < want) {
      const k = this.sprites.length;
      const sh = k % 4 === 3 ? P.termite_soldier : P.termite_worker;
      const s = new Sprite(sh.anims.walk[0]);
      s.anchor.set(sh.anchor[0] / sh.cell[0], sh.anchor[1] / sh.cell[1]);
      s.sheet = sh;
      s.ph = Math.random() * 8;
      this.sg.layer.addChild(s);
      this.sprites.push(s);
    }
  }

  kill(k) {
    this.n = Math.max(0, this.n - k);
    this.sync();
  }

  update(dt) {
    const sp = CONFIG.siege.defenderSpeed;
    this.y += sp * dt;
    this.walk += sp * dt;
    // 近づくほど、こちらの巣（真ん中）へ寄ってくる
    const k = Math.max(0, (this.y - this.sg.moundY) / (this.sg.nestY - this.sg.moundY));
    this.x += (0 - this.x) * Math.min(1, dt * 1.6 * k * k);
    const R = this.r, m = this.sprites.length;
    this.sprites.forEach((s, i) => {
      const rr = R * Math.sqrt((i + 0.5) / Math.max(m, 1)) * (m === 1 ? 0 : 1);
      const th = i * 2.39996;
      const x = this.x + rr * Math.cos(th) * 1.2, y = this.y + rr * Math.sin(th) * 0.75;
      s.position.set(Math.round(x), Math.round(y));
      s.zIndex = y;
      s.texture = s.sheet.anims.walk[Math.floor(this.walk / 2.2 + s.ph) % s.sheet.anims.walk.length];
    });
  }

  destroy() {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }
}
