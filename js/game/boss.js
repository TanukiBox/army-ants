// ボス（各エリアの最後）。群れのまま直接対決：群れを左右に動かして攻撃をよけ、自動で撃つ。
//   エリア1 庭：オオカマキリ … 鎌で群れの一部を刈り取る（左右どちらかを薙ぐ・狙って突き刺す）
//   エリア2 森：ジョロウグモ … 糸を張って群れの動きを遅くする（＋かみつき）
//   エリア3 最終：オオスズメバチ … 空から急降下。倒すと最後に巨大な女王バチ
// 攻撃の前には必ず赤い予告を出す（よけられるように）。攻撃のときだけ画面をゆらす。
import { Container, Sprite, Graphics } from '../../vendor/pixi.min.mjs';
import { CONFIG } from './config.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';
import { C as FXC, textures } from '../core/fx.js';
import { addHoney, inv } from './meta.js';

const HALF = CONFIG.track.width / 2;

/** シートの1コマ目の足元を Sprite の基準にする */
function sheetSprite(sheet, anim) {
  const s = new Sprite(sheet.anims[anim][0]);
  s.anchor.set(sheet.anchor[0] / sheet.cell[0], sheet.anchor[1] / sheet.cell[1]);
  return s;
}

function firstAnim(sheet, names) {
  for (const n of names) if (sheet?.anims[n]) return n;
  return Object.keys(sheet.anims)[0];
}

export class Boss {
  /**
   * @param field  runner.js の Field（群れ・粒・弾を共有）
   * @param kind   'mantis' | 'spider' | 'hornet' | 'queen'
   * @param hooks  { onDefeated() }
   */
  constructor(field, kind, hooks) {
    this.f = field;
    this.G = field.G;
    this.kind = kind;
    this.hooks = hooks;
    this.cfg = CONFIG.bosses[kind];
    this.hp = this.hp0 = Math.round(this.cfg.hp * inv(field.G.run, 'bossPer'));
    this.alive = true;
    this.sheet = this.G.sprites.bosses[kind];
    this.wings = this.G.sprites.bosses[kind + '_wings'] || null;
    this.idleAnim = firstAnim(this.sheet, ['idle', 'fly']);
    this.atkAnim = firstAnim(this.sheet, kind === 'hornet' ? ['dive', 'attack'] : ['attack', 'dive']);
    this.anim = this.idleAnim;
    this.animT = 0;
    this.layer = new Container();
    this.glowL = new Container();
    field.top.addChild(this.layer);
    field.glow.addChild(this.glowL);
    this.shadow = new Graphics();
    field.under.addChild(this.shadow);
    this.warnG = new Graphics();      // 赤い予告（群れの上に光らせて、大きな群れでも見えるように）
    field.glow.addChild(this.warnG);
    this.spr = sheetSprite(this.sheet, this.idleAnim);
    this.layer.addChild(this.spr);
    if (this.wings) {
      this.wingSpr = sheetSprite(this.wings, firstAnim(this.wings, [this.idleAnim]));
      this.wingSpr.alpha = 0.55;
      this.layer.addChild(this.wingSpr);
    }
    this.gl = this.sheet.glow ? sheetSprite({ ...this.sheet, anims: this.sheet.glow }, this.idleAnim) : null;
    if (this.gl) this.glowL.addChild(this.gl);
    this.hurt = new Sprite();
    this.hurt.anchor.copyFrom(this.spr.anchor);
    this.hurt.alpha = 0;
    this.glowL.addChild(this.hurt);
    this.T = textures();
    // 画面の上のほうに、カメラと一緒に動く
    this.ox = 0;            // 横の位置
    this.oyScreen = 0.22;   // 画面の上から何割
    this.lift = 0;          // 急降下で下がる量（ドット）
    this.poison = 0;
    this.attackT = 2.2;
    this.action = null;     // いま出している攻撃
    this.webs = [];
    this.minions = [];
    this.enterT = 1.2;      // 登場の演出
    this.hurtT = 0;
    this.flashCD = 0;
    this.time = 0;
    this.G.hud.bossBar(t('boss_' + kind), 1);
    sfx.warn();
    this.update(0);
  }

  get x() { return this.ox; }
  get y() { const v = this.G.view; return v.camY - v.H / 2 + v.H * this.oyScreen + this.lift; }

  /** 当たり判定（体の中心あたりの楕円） */
  hitTest(x, y) {
    if (!this.alive || this.enterT > 0) return false;
    const [cw, ch] = this.sheet.cell;
    const rx = cw * 0.32, ry = ch * 0.28;
    const cy = this.y - ch * 0.12;
    return ((x - this.x) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
  }

  hitCircle(x, y, r) {
    const [cw, ch] = this.sheet.cell;
    return Math.hypot(x - this.x, y - (this.y - ch * 0.12)) < r + cw * 0.3;
  }

  target() { return { x: this.x, y: this.y - this.sheet.cell[1] * 0.1 }; }

  /** アギトアリの顎が届くか（ボスが群れの近くまで降りてきたとき） */
  inMelee(sw) {
    if (!this.alive) return false;
    return this.y + 10 > sw.y - sw.ry - CONFIG.weapons.mandible.range && Math.abs(this.x - sw.x) < sw.rx + 60;
  }

  damage(d, poison = 0) {
    if (!this.alive || this.enterT > 0) return;
    if (this.kind === 'hornet' || this.kind === 'queen') {
      if (this.lift > 40) d *= this.cfg.lowBonus ?? 1.5;    // 降りてきたときは弱い
    }
    this.hp -= d;
    this.poison += poison;
    if (this.flashCD <= 0) { this.hurtT = 0.06; this.flashCD = 0.2; }   // 当たるたびに光りっぱなしにならないよう間をあける
    if (Math.random() < 0.25) sfx.hit();
    if (this.hp <= 0) this.defeat();
  }

  defeat() {
    this.alive = false;
    addHoney(this.G.run, CONFIG.honey.boss[['mantis', 'spider', 'hornet', 'queen'].indexOf(this.kind)] ?? 0);
    this.hp = 0;
    this.action = null;
    this.warnG.clear();
    const fx = this.f.fx;
    for (let i = 0; i < 6; i++) {
      this.G.later(i * 0.16, () => {
        if (!this.layer.destroyed) fx.explode(this.x + (Math.random() - 0.5) * 70, this.y - 20 + (Math.random() - 0.5) * 50, 3, this.G.view);
      });
    }
    sfx.bossDown();
    this.G.view.shake(CONFIG.feel.shakeBig + 2);
    this.G.flash(0xffffff, 0.35);
    this.G.hud.bossBar(null);
    for (const m of this.minions) for (const sp of [m.s, m.w, m.gl]) sp?.destroy();
    this.minions = [];
    this.deathT = 1.2;
  }

  // ---------------------------------------------------------------------------
  // 攻撃（予告 → 当たる）
  // ---------------------------------------------------------------------------
  chooseAttack() {
    const sw = this.f.swarm;
    const k = this.kind, c = this.cfg;
    const r = Math.random();
    if (k === 'mantis') {
      if (r < 0.55) {
        // 左右どちらかを鎌で薙ぐ（群れのいる側をねらう）
        // 道の 45% だけを薙ぐ：残りの 55% には群れ（横幅は上限つき）が必ず入れる
        const side = sw.x < 0 ? -1 : 1;
        const w = CONFIG.track.width * 0.45;
        const x0 = side < 0 ? -HALF : HALF - w, x1 = side < 0 ? -HALF + w : HALF;
        return { type: 'sweep', warn: c.sweepWarn, x0, x1 };
      }
      return { type: 'stab', warn: c.stabWarn, x: sw.x, y: sw.y, r: c.stabRadius };
    }
    if (k === 'spider') {
      if (r < 0.6) return { type: 'web', warn: 0.6, x: sw.x + (Math.random() - 0.5) * 60, y: sw.y - 60 - Math.random() * 60 };
      return { type: 'stab', warn: c.biteWarn, x: sw.x, y: sw.y, r: c.biteRadius, power: c.bite };
    }
    if (k === 'queen' && r < 0.3 && this.minions.length < 2) return { type: 'minions', warn: 0.5 };
    if (k === 'queen' && r < 0.55) return { type: 'stingers', warn: 0.6 };
    return { type: 'dive', warn: c.diveWarn, x: sw.x, y: sw.y, r: c.diveRadius };
  }

  startAttack() {
    this.action = { ...this.chooseAttack(), t: 0, phase: 'warn' };
    this.anim = this.atkAnim;
    this.animT = 0;
    sfx.warn();
  }

  /** 群れのうち、条件に合うアリの割合で減らす（甲殻装甲で減る数が少なくなる） */
  reap(test, power, cx, cy) {
    const sw = this.f.swarm;
    let inside = 0, shown = 0;
    for (const a of sw.ants) {
      if (a.carpet) continue;
      shown++;
      if (test(a)) inside++;
    }
    if (!inside) return;
    const k = Math.max(1, Math.round(sw.count * (inside / Math.max(1, shown)) * power));
    this.f.loseAnts(k, { pick: (a) => (test(a) ? 0 : 1) + Math.random() * 0.3, armor: true, at: { x: cx, y: cy } });
    sfx.hurt();
  }

  updateAction(dt) {
    const A = this.action;
    if (!A) return;
    A.t += dt;
    const sw = this.f.swarm;
    // 地上のボス（カマキリ・クモ）は、攻撃の瞬間に群れへ踏みこむ
    if ((this.kind === 'mantis' || this.kind === 'spider') && A.type !== 'web') {
      const v = this.G.view;
      const base = v.camY - v.H / 2 + v.H * this.oyScreen;
      const want = A.phase === 'hit' ? Math.max(0, Math.min(220, sw.y - base - 120)) : A.t / (A.warn || 1) * 18;
      this.lift += (want - this.lift) * Math.min(1, dt * (A.phase === 'hit' ? 14 : 3));
    }
    const c = this.cfg;
    const g = this.warnG;
    g.clear();
    const blink = 0.35 + 0.35 * Math.abs(Math.sin(A.t * 14));
    if (A.type === 'sweep') {
      const yTop = sw.y - sw.ry - 24, yBot = sw.y + sw.ry + 16;
      if (A.phase === 'warn') {
        g.rect(A.x0, yTop, A.x1 - A.x0, yBot - yTop).fill({ color: 0xff2020, alpha: 0.08 + blink * 0.16 });
        g.rect(A.x0, yTop, A.x1 - A.x0, 1).fill({ color: 0xff3a2a, alpha: 0.9 });
        g.rect(A.x0, yBot - 1, A.x1 - A.x0, 1).fill({ color: 0xff3a2a, alpha: 0.6 });
        if (A.t >= A.warn) {
          A.phase = 'hit';
          A.t = 0;
          this.reap((a) => a.x >= A.x0 && a.x <= A.x1 && a.y > yTop && a.y < yBot, c.reap, (A.x0 + A.x1) / 2, sw.y);
          const fx = this.f.fx;
          for (let i = 0; i < 6; i++) {
            const x = A.x0 + (A.x1 - A.x0) * Math.random();
            fx.ring(fx.glow, x, sw.y - 10, 2, 16, 0.25, 0xa8ff60, 0.9);
          }
          fx.burst(fx.glow, (A.x0 + A.x1) / 2, sw.y - 20, 18, { color: [0xd8ff9a, 0x5e7432, 0xffffff], speed: [60, 160], life: [0.15, 0.35], drag: 6, angle: Math.PI / 2 * (A.x0 < 0 ? 1 : -1), spread: 1.2 });
          this.G.view.shake(CONFIG.feel.shakeBig);
          sfx.swoosh();
        }
      } else if (A.t > 0.3) this.endAction();
    } else if (A.type === 'stab' || A.type === 'dive') {
      if (A.phase === 'warn') {
        g.ellipse(A.x, A.y, A.r * 1.25, A.r * 0.8).fill({ color: 0xff2020, alpha: 0.1 + blink * 0.22 });
        g.ellipse(A.x, A.y, A.r * 1.25, A.r * 0.8).stroke({ color: 0xff3a2a, width: 1, alpha: 0.9 });
        if (A.type === 'dive') {
          // 影が地面に落ちる
          this.lift = Math.min(1, A.t / A.warn) * 30;
        }
        if (A.t >= A.warn) {
          A.phase = 'hit';
          A.t = 0;
          if (A.type === 'dive') {
            this.oxTarget = A.x;
            this.diving = true;
            sfx.swoosh();
          } else this.strike(A);
        }
      } else if (A.type === 'dive') {
        // 急降下：影の場所まで一気に下りて、たたきつける
        const v = this.G.view;
        const goal = A.y - (v.camY - v.H / 2 + v.H * this.oyScreen) + 10;
        this.ox += (A.x - this.ox) * Math.min(1, dt * 14);
        this.lift += (goal - this.lift) * Math.min(1, dt * 12);
        if (!A.struck && A.t > 0.18) { A.struck = true; this.strike(A); }
        if (A.t > 0.9) this.endAction();
      } else if (A.t > 0.35) this.endAction();
    } else if (A.type === 'web') {
      if (A.phase === 'warn') {
        g.ellipse(A.x, A.y, c.webRadius * 1.2, c.webRadius * 0.7).stroke({ color: 0xff3a2a, width: 1, alpha: 0.4 + blink });
        if (A.t >= A.warn) {
          A.phase = 'hit';
          this.addWeb(A.x, A.y);
          this.endAction();
        }
      }
    } else if (A.type === 'minions') {
      if (A.t >= A.warn) {
        for (let i = 0; i < c.minions; i++) this.addMinion(this.x + (i - 1) * 40, this.y);
        this.endAction();
      }
    } else if (A.type === 'stingers') {
      if (A.t >= A.warn) {
        for (let i = 0; i < c.stingers; i++) {
          const ang = (i - (c.stingers - 1) / 2) * 0.22;
          this.f.enemyShot(this.x, this.y + 10, this.x + Math.sin(ang) * 400, this.y + Math.cos(ang) * 400);
        }
        this.endAction();
      }
    }
  }

  strike(A) {
    const sw = this.f.swarm;
    const power = A.power ?? (A.type === 'dive' ? this.cfg.dive : this.cfg.reap ?? 0.3);
    this.reap((a) => ((a.x - A.x) / (A.r * 1.25)) ** 2 + ((a.y - A.y) / (A.r * 0.8)) ** 2 < 1, power, A.x, A.y);
    const fx = this.f.fx;
    fx.ring(fx.glow, A.x, A.y, 4, Math.min(34, A.r), 0.3, 0xff6a3a, 1);
    fx.burst(fx.over, A.x, A.y, 16, { color: [0x2a2019, 0x1a1411, 0x3a2d23], speed: [40, 110], life: [0.3, 0.6], drag: 5, size: 2 });
    this.G.view.shake(CONFIG.feel.shakeBig);
    sfx.explode(false);
  }

  endAction() {
    this.action = null;
    this.warnG.clear();
    this.anim = this.idleAnim;
    this.attackT = this.cfg.attackEvery * (0.8 + Math.random() * 0.4);
  }

  addWeb(x, y) {
    const g = new Graphics();
    const R = this.cfg.webRadius;
    // クモの巣：放射状の糸と、ぐるぐるの糸（光る銀色）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.moveTo(x, y).lineTo(x + Math.cos(a) * R * 1.2, y + Math.sin(a) * R * 0.7);
    }
    for (let k = 1; k <= 4; k++) g.ellipse(x, y, R * 1.2 * k / 4, R * 0.7 * k / 4);
    g.stroke({ color: 0xc8d0e0, width: 1, alpha: 0.5 });
    this.f.glow.addChild(g);
    this.webs.push({ x, y, r: R, g, t: this.cfg.webTime });
    sfx.swoosh();
  }

  addMinion(x, y) {
    const B = this.G.sprites.bosses;
    const sh = B.minion || B.hornet;
    const s = sheetSprite(sh, firstAnim(sh, ['fly']));
    this.layer.addChild(s);
    let w = null, gl = null;
    if (B.minion_wings) { w = sheetSprite(B.minion_wings, 'fly'); w.alpha = 0.55; this.layer.addChild(w); }
    if (sh.glow) { gl = sheetSprite({ ...sh, anims: sh.glow }, 'fly'); this.glowL.addChild(gl); }
    this.minions.push({ s, w, gl, x, y, hp: this.cfg.minionHp, t: Math.random() * 2, state: 'hover', sheet: sh, wings: B.minion_wings });
  }

  updateMinions(dt) {
    const sw = this.f.swarm;
    const keep = [];
    for (const m of this.minions) {
      m.t += dt;
      if (m.state === 'hover') {
        m.x += (sw.x + Math.sin(m.t * 2) * 60 - m.x) * dt * 1.5;
        m.y += (sw.y - 160 - m.y) * dt * 2;
        if (m.t > 2.5) { m.state = 'dive'; m.tx = sw.x; m.ty = sw.y; sfx.swoosh(); }
      } else {
        m.x += (m.tx - m.x) * dt * 6;
        m.y += (m.ty - m.y) * dt * 6;
        if (Math.hypot(m.tx - m.x, m.ty - m.y) < 6) {
          this.reap((a) => Math.hypot(a.x - m.tx, a.y - m.ty) < 26, 0.2, m.tx, m.ty);
          this.f.fx.burst(this.f.fx.over, m.tx, m.ty, 10, { color: [0x2a2019, 0x1a1411], speed: [30, 80], life: [0.3, 0.5], drag: 5 });
          m.hp = 0;
        }
      }
      // 弾が当たる
      for (const b of this.f.bullets) {
        if (Math.hypot(b.x - m.x, b.y - m.y) < 14) { m.hp -= b.dmg; b.y = -1e9; }
      }
      const fr = m.sheet.anims.fly || Object.values(m.sheet.anims)[0];
      const fi = Math.floor(m.t * 18) % fr.length;
      m.s.texture = fr[fi];
      if (m.w) m.w.texture = m.wings.anims.fly[fi % m.wings.anims.fly.length];
      if (m.gl) m.gl.texture = m.sheet.glow.fly[fi];
      for (const sp of [m.s, m.w, m.gl]) sp?.position.set(Math.round(m.x), Math.round(m.y));
      if (m.hp <= 0) {
        this.f.fx.burst(this.f.fx.glow, m.x, m.y, 10, { color: [FXC.orange, FXC.yellow], speed: [30, 90], life: [0.2, 0.4], drag: 5 });
        for (const sp of [m.s, m.w, m.gl]) sp?.destroy();
        continue;
      }
      keep.push(m);
    }
    this.minions = keep;
  }

  updateWebs(dt) {
    const sw = this.f.swarm;
    let slow = 1;
    this.webs = this.webs.filter((w) => {
      w.t -= dt;
      w.g.alpha = Math.min(1, w.t);
      if (((sw.x - w.x) / (w.r * 1.2)) ** 2 + ((sw.y - w.y) / (w.r * 0.7)) ** 2 < 1.3) slow = Math.min(slow, this.cfg.webSlow);
      if (w.t <= 0) { w.g.destroy(); return false; }
      return true;
    });
    // 糸に入ると群れの動きが遅くなる（群れの前進に合わせて、糸も画面に残る）
    sw.followMul = slow;
  }

  update(dt) {
    this.time += dt;
    const sw = this.f.swarm;
    if (this.enterT > 0) {
      this.enterT -= dt;
      this.oyScreen = 0.22 - Math.max(0, this.enterT) * 0.25;
    }
    if (this.alive) {
      if (this.poison > 0) {
        const p = Math.min(this.poison, dt * 6);
        this.poison -= p;
        this.hp -= p;
        if (this.hp <= 0) this.defeat();
      }
      this.G.hud.bossBar(t('boss_' + this.kind), this.hp / this.hp0);
    }
    if (this.alive && this.enterT <= 0) {
      if (!this.action) {
        // ふだんはゆっくり左右に動く
        if (!this.diving) this.ox += (Math.sin(this.time * 0.6) * HALF * 0.55 - this.ox) * dt * 0.8;
        this.lift += (0 - this.lift) * Math.min(1, dt * 3);
        if (this.lift < 2) this.diving = false;
        this.attackT -= dt;
        if (this.attackT <= 0 && sw.count > 0) this.startAttack();
      }
      this.updateAction(dt);
    }
    this.updateWebs(dt);
    this.updateMinions(dt);
    // 絵
    this.animT += dt;
    const info = this.sheet.info[this.anim];
    const frames = this.sheet.anims[this.anim];
    let fi;
    if (this.anim === this.atkAnim && this.action) {
      const dur = (this.action.warn || 0.6) + 0.3;
      fi = Math.min(frames.length - 1, Math.floor((this.action.phase === 'hit' ? 0.7 + this.action.t / 0.6 * 0.3 : this.action.t / dur * 0.7) * frames.length));
    } else fi = Math.floor(this.animT * (info?.fps || 8)) % frames.length;
    fi = Math.max(0, Math.min(frames.length - 1, fi));
    this.spr.texture = frames[fi];
    if (this.gl) this.gl.texture = this.sheet.glow[this.anim]?.[fi] ?? this.gl.texture;
    if (this.wingSpr) {
      const wf = this.wings.anims[this.anim] || Object.values(this.wings.anims)[0];
      this.wingSpr.texture = wf[fi % wf.length];
    }
    const px = Math.round(this.x), py = Math.round(this.y);
    for (const s of [this.spr, this.gl, this.wingSpr, this.hurt]) s?.position.set(px, py);
    this.flashCD -= dt;
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      this.hurt.texture = this.sheet.white[this.anim][fi];
      this.hurt.alpha = 0.3;
    } else this.hurt.alpha = 0;
    if (this.gl) this.gl.alpha = 0.75 + 0.25 * Math.sin(this.time * 3);
    // 影（空を飛ぶボス）
    this.shadow.clear();
    if (this.kind === 'hornet' || this.kind === 'queen') {
      const v = this.G.view;
      // 影は足元（anchor）に。急降下の予告中は、落ちてくる場所に
      const A = this.action;
      const sx = A?.type === 'dive' && A.phase === 'warn' ? A.x : px;
      const sy = A?.type === 'dive' && A.phase === 'warn' ? A.y : py;
      const big = this.kind === 'queen' ? 1.4 : 1;
      this.shadow.ellipse(Math.round(sx), Math.round(sy), 26 * big, 9 * big).fill({ color: 0x000000, alpha: 0.35 });
    }
    // 倒れたあと
    if (!this.alive) {
      this.deathT -= dt;
      this.spr.alpha = Math.max(0, this.deathT);
      if (this.gl) this.gl.alpha = Math.max(0, this.deathT);
      if (this.wingSpr) this.wingSpr.alpha = Math.max(0, this.deathT) * 0.55;
      if (this.deathT <= 0 && !this.reported) {
        this.reported = true;
        this.hooks.onDefeated?.();
      }
    }
  }

  destroy() {
    for (const w of this.webs) w.g.destroy();
    for (const m of this.minions) for (const sp of [m.s, m.w, m.gl]) sp?.destroy();
    this.layer.destroy({ children: true });
    this.glowL.destroy({ children: true });
    this.shadow.destroy();
    this.warnG.destroy();
    this.f.swarm.followMul = 1;
  }
}
