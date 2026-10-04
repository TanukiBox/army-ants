"""地面の部品の元画像をレンダリングする（Blender の中で動く）。

  soil_<エリア>.png … 土のタイル（tile × tile ドット。上下左右にすき間なく並べられる）
  decor.png … 落ち葉・小石・小枝を cell × cell のマスに並べたもの

  blender -b --factory-startup -P render_ground.py -- --out <dir> [--tile 128 --cell 48 --ss 8 --ppu 20]
"""
import argparse
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import common as C  # noqa: E402
import ground as G  # noqa: E402

DECOR_COLS = 8


def soil_scene(tile, ss, ppu, res=160, area="garden"):
    C.reset_scene()
    C.set_resolution(tile * ss, tile * ss)
    w = tile / ppu
    h = w / math.sin(math.radians(C.ELEVATION_DEG))   # 画面の高さ w に写る地面の奥行き
    C.link(bpy.data.objects.new("soil", G.soil_tile(w, h, res, area)))
    C.oblique_camera(w)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print("  saved:", path, flush=True)


def render_decor(out_png, cell, ss, ppu):
    C.reset_scene()
    n = len(G.DECOR)
    rows = (n + DECOR_COLS - 1) // DECOR_COLS
    C.set_resolution(DECOR_COLS * cell * ss, rows * cell * ss)
    cu = cell / ppu
    for k, (name, make) in enumerate(G.DECOR):
        c, r = k % DECOR_COLS, k // DECOR_COLS
        ob = C.link(bpy.data.objects.new(name, make()))
        ob.location = C.screen_to_ground((c - (DECOR_COLS - 1) / 2) * cu, ((rows - 1) / 2 - r) * cu)
        ob.rotation_euler = (0, 0, C.rng_for(name).uniform(-1.2, 1.2))
    C.oblique_camera(DECOR_COLS * cu)
    C.render_to(out_png)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=256)
    p.add_argument("--cell", type=int, default=64)
    p.add_argument("--ss", type=int, default=8)
    p.add_argument("--ppu", type=float, default=20.0)
    p.add_argument("--blend", default="")
    p.add_argument("--areas", default="garden")
    a = p.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    for area in a.areas.split(","):
        print("== soil", area, flush=True)
        soil_scene(a.tile, a.ss, a.ppu, area=area)
        C.render_to(os.path.join(out, f"soil_{area}.png"))
    print("== decor", flush=True)
    render_decor(os.path.join(out, "decor.png"), a.cell, a.ss, a.ppu)
    if a.blend:
        bl = os.path.abspath(a.blend)
        os.makedirs(bl, exist_ok=True)
        save_blend(os.path.join(bl, "ground_decor.blend"))
        soil_scene(a.tile, a.ss, a.ppu, res=48, area="forest")   # 見本は軽くするため粗いメッシュで保存
        save_blend(os.path.join(bl, "ground_soil.blend"))


main()
