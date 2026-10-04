// 暗い地面：土のタイルを敷きつめ、落ち葉・小石・小枝などを散らす。
// 散らし方は「行の番号」から決まる乱数なので、同じ場所にはいつも同じ物がある。
// エリアごとに土のタイルと、散らす物の種類が変わる。
import { Container, Sprite, TilingSprite } from '../../vendor/pixi.min.mjs';
import { rngFor } from './rng.js';

const ROW = 32;   // 散らす単位（ドット）

// エリアごとの散らす物：[名前の始まり, 1行あたりの数の目安]
const AREA_DECOR = {
  garden: [['leaf_brown', 0.9], ['leaf_red', 0.5], ['leaf_small', 0.6], ['pebble', 0.55], ['grass', 0.7], ['twig', 0.12]],
  forest: [['leaf', 2.2], ['moss', 0.45], ['mushroom', 0.35], ['twig', 0.2], ['pebble', 0.25]],
  hive:   [['paper', 0.9], ['leaf_olive', 0.5], ['leaf_brown', 0.4], ['pebble', 0.5], ['twig', 0.15]],
};

export class Ground {
  constructor(sprites, area = 'garden', glowLayer = null) {
    this.sprites = sprites;
    this.layer = new Container();
    this.soil = new TilingSprite({ texture: sprites.soils?.[area] || sprites.soil, width: 64, height: 64 });
    this.decorLayer = new Container();
    this.glowLayer = glowLayer;          // 光るキノコなど
    this.layer.addChild(this.soil, this.decorLayer);
    this.rows = new Map();   // 行の番号 → その行の Sprite たち
    this.seed = 'ground';
    this.setArea(area);
  }

  setArea(area) {
    this.area = AREA_DECOR[area] ? area : 'garden';
    this.soil.texture = this.sprites.soils?.[this.area] || this.sprites.soil;
    this.pools = AREA_DECOR[this.area].map(([prefix, n]) => [this.sprites.decor.filter((d) => d.name.startsWith(prefix)), n])
      .filter(([pool]) => pool.length);
    for (const list of this.rows.values()) for (const s of list) s.destroy();
    this.rows.clear();
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
    for (let r = r0; r <= r1; r++) if (!this.rows.has(r)) this.rows.set(r, this.makeRow(r));
  }

  makeRow(r) {
    const rng = rngFor(this.seed + ':' + this.area + ':' + r);
    const list = [];
    const span = 440;   // 横に散らす幅（画面より広め）
    // 多い所・少ない所をゆるやかに変える
    const dens = 0.55 + 0.45 * Math.sin(r * 0.37) * Math.sin(r * 0.11 + 1.3);
    for (const [pool, n] of this.pools) {
      let k = Math.floor(n * (0.5 + dens) + rng());
      while (k-- > 0) {
        const d = pool[Math.floor(rng() * pool.length)];
        const x = Math.round((rng() - 0.5) * span), y = Math.round(r * ROW + rng() * ROW);
        const flip = rng() < 0.5 ? -1 : 1;   // 回転させるとドットが崩れるので、左右反転だけ
        const s = new Sprite(d.tex);
        s.anchor.set(0.5);
        s.position.set(x, y);
        s.scale.x = flip;
        this.decorLayer.addChild(s);
        list.push(s);
        if (d.glow && this.glowLayer && d.name.startsWith('mushroom')) {
          const g = new Sprite(d.glow);
          g.anchor.set(0.5);
          g.position.set(x, y);
          g.scale.x = flip;
          g.alpha = 0.8;
          this.glowLayer.addChild(g);
          list.push(g);
        }
      }
    }
    return list;
  }

  clear() {
    for (const list of this.rows.values()) for (const s of list) s.destroy();
    this.rows.clear();
  }
}
