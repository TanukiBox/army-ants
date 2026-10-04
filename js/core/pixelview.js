// ドット絵の画面：小さな解像度で描いてから、整数倍・ぼかさずに拡大して表示する。
// 光る部分（glow）は別に描いて加算で重ね、さらに縮小してぼかした「ブルーム」を控えめに足す。
//
//   world   … 地面・アリ・敵など（ふつうに重ねる）。カメラで動く
//   glow    … 光る部分（加算）。カメラで動く
//   overlay … 画面に固定のもの（暗いふち取りなど）。world の上に描く
import { Container, RenderTexture, Sprite, BlurFilter } from '../../vendor/pixi.min.mjs';

const BG = 0x0b0908;

export class PixelView {
  constructor(app, opts = {}) {
    this.app = app;
    this.targetW = opts.targetW ?? 380;     // 縦画面の横幅の目安（ドット）
    this.targetH = opts.targetH ?? 680;     // 横長の画面での高さの目安（ドット）
    this.zoom = 1;
    this.bloom = opts.bloom ?? 0.5;         // ブルームの強さ（控えめ）
    this.world = new Container();
    this.glow = new Container();
    this.overlay = new Container();
    this.camX = 0;
    this.camY = 0;
    this.shakeAmp = 0;

    this.screen = new Sprite();
    this.glowScreen = new Sprite();
    this.glowScreen.blendMode = 'add';
    this.bloomScreen = new Sprite();
    this.bloomScreen.blendMode = 'add';
    this.bloomSrc = new Sprite();
    this.bloomSrc.filters = [new BlurFilter({ strength: 3, quality: 3 })];
    this.root = new Container();
    this.root.addChild(this.screen, this.glowScreen, this.bloomScreen);
    app.stage.addChild(this.root);
    this.resize();
  }

  /** 画面の大きさが変わったとき：拡大率（整数）と、小さな解像度を決め直す */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const box = this.app.canvas.parentElement.getBoundingClientRect();
    const cssW = Math.max(1, box.width), cssH = Math.max(1, box.height);
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    this.app.renderer.resize(devW, devH);
    this.app.canvas.style.width = cssW + 'px';
    this.app.canvas.style.height = cssH + 'px';
    this.cssW = cssW;
    this.cssH = cssH;
    this.baseScale = Math.max(1, Math.round(Math.min(devW / this.targetW, devH / this.targetH)));
    this.scale = this.baseScale * this.zoom;
    this.W = Math.ceil(devW / this.scale);
    this.H = Math.ceil(devH / this.scale);
    for (const k of ['worldRT', 'glowRT', 'bloomRT']) this[k]?.destroy(true);
    this.worldRT = RenderTexture.create({ width: this.W, height: this.H, scaleMode: 'nearest', antialias: false });
    this.glowRT = RenderTexture.create({ width: this.W, height: this.H, scaleMode: 'nearest', antialias: false });
    this.bloomRT = RenderTexture.create({ width: Math.ceil(this.W / 2), height: Math.ceil(this.H / 2), scaleMode: 'linear' });
    this.screen.texture = this.worldRT;
    this.glowScreen.texture = this.glowRT;
    this.bloomScreen.texture = this.bloomRT;
    this.bloomSrc.texture = this.glowRT;
    this.bloomSrc.scale.set(0.5);
    this.screen.scale.set(this.scale);
    this.glowScreen.scale.set(this.scale);
    this.bloomScreen.scale.set(this.scale * 2);
    this.bloomScreen.alpha = this.bloom;
    this.onResize?.(this.W, this.H);
  }

  setZoom(z) {
    this.zoom = z;
    this.resize();
  }

  /** 画面をゆらす（大きな爆発・ボスの攻撃のときだけ使う） */
  shake(amp) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  /** 小さな画面上の点（ドット）→ 画面の CSS 座標の比率 */
  get dotsPerCss() {
    return this.W / this.cssW;
  }

  render(dt) {
    const r = this.app.renderer;
    const ox = Math.round(this.W / 2 - this.camX), oy = Math.round(this.H / 2 - this.camY);
    this.world.position.set(ox, oy);
    this.glow.position.set(ox, oy);
    r.render({ container: this.world, target: this.worldRT, clear: true, clearColor: BG });
    r.render({ container: this.overlay, target: this.worldRT, clear: false });
    r.render({ container: this.glow, target: this.glowRT, clear: true, clearColor: [0, 0, 0, 0] });
    r.render({ container: this.bloomSrc, target: this.bloomRT, clear: true, clearColor: [0, 0, 0, 0] });
    // ゆれ：ドットの大きさ単位でずらす（ドットがずれて見えないように）
    let sx = 0, sy = 0;
    if (this.shakeAmp > 0.2) {
      sx = Math.round((Math.random() * 2 - 1) * this.shakeAmp) * this.scale;
      sy = Math.round((Math.random() * 2 - 1) * this.shakeAmp) * this.scale;
      this.shakeAmp *= Math.exp(-dt * 9);
    } else this.shakeAmp = 0;
    this.root.position.set(sx, sy);
  }
}
