// art/build.py が書き出したドット絵（assets/sprites/）を読み込み、コマごとに切り分ける。
import { Assets, Texture, Rectangle } from '../../vendor/pixi.min.mjs';

function nearest(tex) {
  tex.source.scaleMode = 'nearest';
  return tex;
}

function cut(tex, x, y, w, h) {
  return new Texture({ source: tex.source, frame: new Rectangle(x, y, w, h) });
}

/** シート → frames[向き][コマ] */
function sheetFrames(tex, cell, dirs, frames) {
  const out = [];
  for (let d = 0; d < dirs; d++) {
    const row = [];
    for (let f = 0; f < frames; f++) row.push(cut(tex, f * cell, d * cell, cell, cell));
    out.push(row);
  }
  return out;
}

/** 色のついた所をすべて白にした「影絵」（変異の瞬間・攻撃を受けた瞬間に光らせるのに使う） */
function silhouette(tex) {
  const res = tex.source.resource;
  const c = document.createElement('canvas');
  c.width = tex.source.width;
  c.height = tex.source.height;
  const g = c.getContext('2d');
  g.drawImage(res, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] > 0) { p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = 255; }
  }
  g.putImageData(img, 0, 0);
  return nearest(Texture.from(c));
}

/** コマを並べたシート（敵・小物・ボス）→ { anims: {名前: [Texture...]}, glow, white, cell, anchor } */
function makeSheet(entry, col, glow) {
  const [cw, ch] = entry.cell;
  const split = (tex) => {
    const out = {};
    for (const [name, a] of Object.entries(entry.anims)) {
      out[name] = [];
      for (let f = 0; f < a.frames; f++) out[name].push(cut(tex, f * cw, a.row * ch, cw, ch));
    }
    return out;
  };
  const sheet = {
    cell: entry.cell, anchor: entry.anchor, info: entry.anims,
    anims: split(col), glow: glow ? split(glow) : null,
    _col: col, _white: null,
    get white() {
      if (!this._white) this._white = split(silhouette(this._col));
      return this._white;
    },
  };
  return sheet;
}

async function loadSheets(base, entries) {
  const out = {};
  await Promise.all(Object.entries(entries || {}).map(async ([name, e]) => {
    const col = nearest(await Assets.load(base + e.file));
    const glow = e.glow ? nearest(await Assets.load(base + e.glow)) : null;
    out[name] = makeSheet(e, col, glow);
  }));
  return out;
}

export async function loadSprites(base, onProgress) {
  const manifest = await (await fetch(base + 'sprites.json')).json();
  const A = manifest.ant;
  const ants = {};
  let done = 0;
  const total = A.variants.length + 3;
  const tick = () => onProgress?.(++done / total);
  await Promise.all(A.variants.map(async (name) => {
    const [col, glow] = await Promise.all([
      Assets.load(base + `ants/${name}.png`),
      Assets.load(base + `ants/${name}_glow.png`),
    ]);
    nearest(col);
    nearest(glow);
    ants[name] = {
      color: sheetFrames(col, A.cell, A.dirs, A.frames),
      glow: sheetFrames(glow, A.cell, A.dirs, A.frames),
      _sheet: col,
      _white: null,
      get white() {   // 必要になったときに作る
        if (!this._white) this._white = sheetFrames(silhouette(this._sheet), A.cell, A.dirs, A.frames);
        return this._white;
      },
    };
    tick();
  }));
  const soils = {};
  const files = manifest.soil.files || { garden: manifest.soil.file };
  for (const [area, f] of Object.entries(files)) soils[area] = nearest(await Assets.load(base + f));
  tick();
  const D = manifest.decor;
  const decorSheet = nearest(await Assets.load(base + D.file));
  const decorGlow = D.glow ? nearest(await Assets.load(base + D.glow)) : null;
  const decor = D.items.map((name, i) => {
    const x = (i % D.cols) * D.cell, y = Math.floor(i / D.cols) * D.cell;
    return { name, tex: cut(decorSheet, x, y, D.cell, D.cell), glow: decorGlow ? cut(decorGlow, x, y, D.cell, D.cell) : null };
  });
  tick();
  const props = await loadSheets(base, manifest.props);
  const bosses = await loadSheets(base, manifest.bosses);
  tick();
  return { manifest, ants, soils, soil: soils.garden, decor, props, bosses, antCell: A.cell, glows: manifest.glows };
}
