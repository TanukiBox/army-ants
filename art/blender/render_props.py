"""敵と小物のシートをレンダリングする（Blender の中で動く）。

1枚のシート = 横にコマ、縦にアニメーション。シートごとに <名前>.png と <名前>.json を書き出す
（json の形は pipeline/sheets.py を見てください）。

  blender -b --factory-startup -P render_props.py -- --out <dir> [--ss 8 --ppu 20 --blend <dir>]
"""
import argparse
import math
import json
import os
import sys

import bpy
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import common as C  # noqa: E402
import props as P   # noqa: E402

# 名前, マス(w,h), 足元の位置(マスの左上から), 大きさの倍率, 輪郭, 行 [(アニメ名, コマ数, 速さ, 作り方(frame))]
SHEETS = [
    ("termite_worker", (32, 32), (16, 18), 1.0, True,
     [("walk", 8, 14, lambda f: P.termite("worker", f))]),
    ("termite_soldier", (36, 36), (18, 20), 1.05, True,
     [("walk", 8, 14, lambda f: P.termite("soldier", f))]),
    ("beetle", (64, 64), (32, 34), 1.7, True,
     [("walk", 4, 8, lambda f: P.beetle("walk", f)), ("shoot", 4, 10, lambda f: P.beetle("shoot", f))]),
    ("cocoon", (56, 48), (28, 28), 2.2, True,
     [("stage", 4, 1, lambda f: P.cocoon(f))]),
    ("player_nest", (128, 88), (64, 50), 1.25, True,
     [("idle", 1, 1, lambda f: P.player_nest())]),
    ("termite_mound", (144, 176), (72, 136), 1.35, True,
     [("damage", 4, 1, lambda f: P.termite_mound(f))]),
    ("rocks", (88, 80), (44, 50), 1.0, True,
     [("variant", 3, 1, lambda f: P.rock(f"rock_{f}", [1.55, 1.15, 0.85][f]))]),
    ("puddles", (120, 76), (60, 38), 1.0, False,
     [("variant", 2, 1, lambda f: P.puddle(f"puddle_{f}", [2.4, 1.9][f], [1.25, 1.0][f]))]),
]


def render_sheet(name, cell, anchor, scale, outline, rows, out, ss, ppu):
    C.reset_scene()
    cw, ch = cell
    cols = max(r[1] for r in rows)
    C.set_resolution(cols * cw * ss, len(rows) * ch * ss)
    cu_w, cu_h = cw / ppu, ch / ppu
    # 足元がマスの中心からどれだけずれるか（画面上の長さ）
    du = (anchor[0] - cw / 2) / ppu
    dv = -(anchor[1] - ch / 2) / ppu
    meta = {"name": name, "cell": [cw, ch], "anchor": list(anchor), "anims": {}, "outline": outline, "ss": ss}
    for r, (anim, frames, fps, make) in enumerate(rows):
        meta["anims"][anim] = {"row": r, "frames": frames, "fps": fps}
        for f in range(frames):
            me = make(f)
            ob = C.link(bpy.data.objects.new(f"{name}_{anim}_{f}", me))
            u = (f - (cols - 1) / 2) * cu_w + du
            v = ((len(rows) - 1) / 2 - r) * cu_h + dv
            ob.location = C.screen_to_ground(u, v)
            ob.scale = (scale, scale, scale)
    # 正投影カメラ：横幅 = 全部のコマの幅
    cam = C.oblique_camera(cols * cu_w)
    C.render_to(os.path.join(out, name + ".png"))
    with open(os.path.join(out, name + ".json"), "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--ss", type=int, default=8)
    p.add_argument("--ppu", type=float, default=20.0)
    p.add_argument("--blend", default="")
    p.add_argument("--only", default="")
    a = p.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    only = set(a.only.split(",")) if a.only else None
    for name, cell, anchor, scale, outline, rows in SHEETS:
        if only and name not in only:
            continue
        print("== props", name, flush=True)
        render_sheet(name, cell, anchor, scale, outline, rows, out, a.ss, a.ppu)
        if a.blend and name in ("beetle", "termite_soldier", "termite_mound"):
            bl = os.path.abspath(a.blend)
            os.makedirs(bl, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(bl, f"prop_{name}.blend"), compress=True)
            print("  saved:", name, flush=True)


main()
