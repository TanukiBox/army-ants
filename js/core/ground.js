// 暗い地面：土のタイルを敷きつめ、落ち葉・小石・小枝を散らす。
// 散らし方は「行の番号」から決まる乱数なので、同じ場所にはいつも同じ物がある。
import { Container, Sprite, TilingSprite } from '../../vendor/pixi.min.mjs';
import { rngFor } from './rng.js';

const ROW = 32;   // 散らす単位（ドット）

export class Ground {
  constructor(sprites) {
    this.layer = new Container();
    this.soil = new TilingSprite({ texture: sprites.soil, width: 64, height: 64 });
    this.decorLayer = new Container();
    this.layer.addChild(this.soil, this.decorLayer);
    this.leaves = sprites.decor.filter((d) => d.name.startsWith('leaf'));
    this.pebbles = sprites.decor.filter((d) => d.name.startsWith('pebble'));
    this.twigs = sprites.decor.filter((d) => d.name.startsWith('twig'));
    this.rows = new Map();   // 行の番号 → その行の Sprite たち
    this.seed = 'ground';
  }

  /** カメラの位置と画面の大きさに合わせて、見える範囲を敷き直す */
  update(camX, camY, W, H) {
    const left = Math.floor(camX - W / 2), top = Math.floor(camY - H / 2);
    this.soil.position.set(left, top);
    this.soil.width = W;
    this.soil.height = H;
    this.soil.tilePosition.set(-left, -top);
    const r0 = Math.floor((top - 64) / ROW), r1 = Math.ceil((top + H + 64) / ROW);
    for (const [r, list] of this.rows) {
      if (r < r0 || r > r1) {
        for (const s of list) s.destroy();
        this.rows.delete(r);
      }
    }
    for (let r = r0; r <= r1; r++) if (!this.rows.has(r)) this.rows.set(r, this.makeRow(r, camX, W));
  }

  makeRow(r, camX, W) {
    const rng = rngFor(this.seed + ':' + r);
    const list = [];
    const span = 420;   // 横に散らす幅（画面より広め）
    // 落ち葉の多い所・少ない所をゆるやかに変える
    const dens = 0.55 + 0.45 * Math.sin(r * 0.37) * Math.sin(r * 0.11 + 1.3);
    const put = (pool, n) => {
      for (let i = 0; i < n; i++) {
        const d = pool[Math.floor(rng() * pool.length)];
        const s = new Sprite(d.tex);
        s.anchor.set(0.5);
        s.position.set(Math.round((rng() - 0.5) * span), Math.round(r * ROW + rng() * ROW));
        if (rng() < 0.5) s.scale.x = -1;   // 回転させるとドットが崩れるので、左右反転だけ
        this.decorLayer.addChild(s);
        list.push(s);
      }
    };
    put(this.leaves, Math.floor(dens * 2.2 + rng()));
    put(this.pebbles, rng() < 0.55 ? 1 : 0);
    put(this.twigs, rng() < 0.12 ? 1 : 0);
    return list;
  }
}
