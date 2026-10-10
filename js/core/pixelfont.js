// ドットの数字（群れの頭上の匹数など）。太い 6×7 の字に、1ドットの暗いふちを付ける。
import { Container, Sprite, Texture, Rectangle } from '../../vendor/pixi.min.mjs';

const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00010', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  'x': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '÷': ['00000', '00100', '00000', '11111', '00000', '00100', '00000'],
  '×': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};
const ORDER = Object.keys(GLYPHS);
const GW = 8, GH = 9;   // ふちを含めた1文字の大きさ（太字にして横6 + ふち2）

let atlas = null;

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = GW * ORDER.length;
  c.height = GH;
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  const set = (x, y, r, gg, b) => {
    const i = (y * c.width + x) * 4;
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
  };
  ORDER.forEach((ch, k) => {
    const rows = GLYPHS[ch];
    const on = (x, y) => {   // 太字：右に1ドット広げる
      if (y < 0 || y >= 7) return false;
      const a = x >= 0 && x < 5 && rows[y][x] === '1';
      const b = x - 1 >= 0 && x - 1 < 5 && rows[y][x - 1] === '1';
      return a || b;
    };
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 6; x++) {
        const px = k * GW + x + 1, py = y + 1;
        if (on(x, y)) {
          const top = y < 3;
          set(px, py, top ? 255 : 236, top ? 246 : 222, top ? 232 : 206);
        } else {
          let near = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) near = true;
          if (near) set(px, py, 6, 4, 8);
        }
      }
    }
  });
  g.putImageData(img, 0, 0);
  const tex = Texture.from(c);
  tex.source.scaleMode = 'nearest';
  atlas = {};
  ORDER.forEach((ch, k) => {
    atlas[ch] = new Texture({ source: tex.source, frame: new Rectangle(k * GW, 0, GW, GH) });
  });
}

export class PixelText extends Container {
  constructor(text = '', scale = 1) {
    super();
    if (!atlas) buildAtlas();
    this.pxScale = scale;
    this.text = '';
    this.setText(text);
  }

  setText(text) {
    text = String(text);
    if (text === this.text) return;
    this.text = text;
    // 文字の絵は使い回す（数字は何度も変わるので、作り直すとスマホで引っかかる）
    let x = 0, k = 0;
    for (const ch of text) {
      const t = atlas[ch];
      if (!t) { x += 4; continue; }
      let s = this.children[k];
      if (!s) { s = new Sprite(t); this.addChild(s); }
      s.texture = t;
      s.alpha = 1;
      s.x = x;
      k++;
      x += ch === ',' ? GW - 3 : GW - 1;   // ふちを重ねて詰める
    }
    for (let i = k; i < this.children.length; i++) this.children[i].alpha = 0;
    this.textWidth = x + 1;
    this.scale.set(this.pxScale);
    this.pivot.set(Math.floor(this.textWidth / 2), GH);   // 下の真ん中が基準
  }
}

export function formatCount(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
