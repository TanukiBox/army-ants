"""アリのスプライトシート用の元画像をレンダリングする（Blender の中で動く）。

1枚の画像に「横 = 歩行コマ（8）× 縦 = 向き（8）」のアリを並べて、まとめて1回で描く。
正投影カメラなので、どこに置いても同じ角度・同じ大きさに写る。

  blender -b --factory-startup -P render_ants.py -- --out <dir> --variants base,mandible1 \
          [--cell 32 --ss 8 --ppu 18] [--blend <dir>]
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
import ant as A     # noqa: E402

DIRECTIONS = 8   # 0=上（奥へ進む） 1=右上 2=右 3=右下 4=下 5=左下 6=左 7=左上


def render_sheet(spec, out_png, cell, ss, ppu):
    C.reset_scene()
    frames = A.WALK_FRAMES
    cell_units = cell / ppu
    w, h = frames * cell * ss, DIRECTIONS * cell * ss
    C.set_resolution(w, h)
    meshes = [A.build(spec, f) for f in range(frames)]
    for d in range(DIRECTIONS):
        for f in range(frames):
            u = (f - (frames - 1) / 2) * cell_units
            v = ((DIRECTIONS - 1) / 2 - d) * cell_units
            ob = C.link(bpy.data.objects.new(f"ant_d{d}_f{f}", meshes[f]))
            ob.location = C.screen_to_ground(u, v)
            ob.rotation_euler = (0, 0, -math.radians(45 * d))
    C.oblique_camera(frames * cell_units)
    C.render_to(out_png)


def save_showcase(weapon, levels, path, ppu):
    """Blender で開いて確認できる見本ファイル（Lv1〜3 を並べ、再生すると歩く）。"""
    C.reset_scene()
    scene = bpy.context.scene
    frames = A.WALK_FRAMES
    scene.frame_start, scene.frame_end = 1, frames
    scene.render.fps = 12
    for i, spec in enumerate(levels):
        for f in range(frames):
            ob = C.link(bpy.data.objects.new(f"{spec.name}_walk{f}", A.build(spec, f)))
            ob.location = ((i - (len(levels) - 1) / 2) * 1.6, 0, 0)
            for t in range(1, frames + 1):
                hide = (t - 1) != f
                ob.hide_render = hide
                ob.hide_viewport = hide
                ob.keyframe_insert("hide_render", frame=t)
                ob.keyframe_insert("hide_viewport", frame=t)
    C.oblique_camera(1.6 * len(levels) + 0.4)
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print("  saved:", path, flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--variants", required=True)
    p.add_argument("--cell", type=int, default=40)
    p.add_argument("--ss", type=int, default=8)
    p.add_argument("--ppu", type=float, default=20.0)
    p.add_argument("--blend", default="")
    a = p.parse_args(argv)
    a.out = os.path.abspath(a.out)
    os.makedirs(a.out, exist_ok=True)
    names = [n for n in a.variants.split(",") if n]
    for n in names:
        print("== ant", n, flush=True)
        render_sheet(A.spec_from_name(n), os.path.join(a.out, n + ".png"), a.cell, a.ss, a.ppu)
    if a.blend:
        a.blend = os.path.abspath(a.blend)
        os.makedirs(a.blend, exist_ok=True)
        groups = {}
        for n in names:
            s = A.spec_from_name(n)
            if s.weapon and s.armor:     # 見本は単独の変異だけ（組み合わせは多すぎるので入れない）
                continue
            key = s.weapon or ("armor" if s.armor else "base")
            groups.setdefault(key, []).append(s)
        for key, specs in groups.items():
            print("== blend", key, flush=True)
            save_showcase(key, specs, os.path.join(a.blend, f"ant_{key}.blend"), a.ppu)


main()
