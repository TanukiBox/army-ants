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

/** 色のついた所をすべて白にした「影絵」のシート（変異の瞬間に群れを光らせるのに使う） */
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

export async function loadSprites(base) {
  const manifest = await (await fetch(base + 'sprites.json')).json();
  const A = manifest.ant;
  const ants = {};
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
  }));
  const soil = nearest(await Assets.load(base + manifest.soil.file));
  const decorSheet = nearest(await Assets.load(base + manifest.decor.file));
  const D = manifest.decor;
  const decor = D.items.map((name, i) => ({
    name,
    tex: cut(decorSheet, (i % D.cols) * D.cell, Math.floor(i / D.cols) * D.cell, D.cell, D.cell),
  }));
  return { manifest, ants, soil, decor, antCell: A.cell, glows: manifest.glows };
}
