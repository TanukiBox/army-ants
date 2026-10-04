"""ボスのスプライトシート用の元画像をレンダリングする（Blender の中で動く）。

ボス1体につき1枚の画像：横 = コマ、縦 = 動きの種類（行）。使わないマスは空のまま。
全部のコマを1回でまとめて描く（正投影カメラなので、どこに置いても同じ角度・同じ大きさ）。
はねのあるボス（スズメバチ・女王バチ）は、はねだけのシート <名前>_wings.png も作る
（ゲームが体の上に半透明で重ねる）。

  blender -b --factory-startup -P render_bosses.py -- --out <dir> [--ppu 20] [--blend <dir>] [--only mantis,spider]
"""
import argparse
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import common as C   # noqa: E402
import bosses as B   # noqa: E402

BOSS_SS = 4          # ボスは大きいので 4 倍で描く（アリは 8 倍。小さい働きバチは bosses.py で 8 倍）
MARGIN = 3           # マスのふちに空けるドット数（輪郭線と、となりのコマとのすき間）
WING_ALPHA = 0.55    # はねのシートを重ねるときの不透明度（ゲームへの目安）


def layout(boss):
    spec = B.BOSSES[boss]
    cw, ch = spec["cell"]
    anims = spec["anims"]
    cols = max(n for _, n, _ in anims)
    return cw, ch, anims, cols, len(anims)


def screen_bounds(me):
    """メッシュが画面のどこに写るか（地面の原点からの、右 u・上 v。ワールドの長さ）。"""
    e = math.radians(C.ELEVATION_DEG)
    se, ce = math.sin(e), math.cos(e)
    us = [v.co.x for v in me.vertices]
    vs = [v.co.y * se + v.co.z * ce for v in me.vertices]
    return min(us), max(us), min(vs), max(vs)


def find_anchor(boss, ppu):
    """全部のコマが入る範囲を調べ、マスの真ん中に来るように「足元の点」を決める。"""
    C.reset_scene()
    cw, ch, anims, cols, rows = layout(boss)
    u0 = v0 = float("inf")
    u1 = v1 = -float("inf")
    for anim, n, _ in anims:
        for f in range(n):
            me = B.build(boss, anim, f, "all", name="probe")
            a, b, c, d = screen_bounds(me)
            u0, u1, v0, v1 = min(u0, a), max(u1, b), min(v0, c), max(v1, d)
            bpy.data.meshes.remove(me)
    ax = cw // 2
    ay = int(round(ch / 2 + (v0 + v1) / 2 * ppu))
    w_dots = (u1 - u0) * ppu
    h_dots = (v1 - v0) * ppu
    left = ax + u0 * ppu
    right = cw - (ax + u1 * ppu)
    top = ay - v1 * ppu
    bottom = ch - (ay - v0 * ppu)
    print(f"  {boss}: 絵の大きさ {w_dots:.0f}x{h_dots:.0f} ドット / マス {cw}x{ch} / 足元 ({ax}, {ay}) / "
          f"余白 左{left:.0f} 右{right:.0f} 上{top:.0f} 下{bottom:.0f}", flush=True)
    if min(left, right, top, bottom) < MARGIN:
        print(f"  注意: {boss} の絵がマスのふちに近すぎます（はみ出すおそれ）", flush=True)
    return ax, ay


def render_sheet(boss, layer, sheet, out_dir, ppu, anchor):
    C.reset_scene()
    cw, ch, anims, cols, rows = layout(boss)
    ss = B.BOSSES[boss].get("ss", BOSS_SS)
    C.set_resolution(cols * cw * ss, rows * ch * ss)
    cu, cv = cw / ppu, ch / ppu
    du = (anchor[0] - cw / 2) / ppu
    dv = (ch / 2 - anchor[1]) / ppu
    meta_anims = {}
    for r, (anim, n, fps) in enumerate(anims):
        meta_anims[anim] = {"row": r, "frames": n, "fps": fps}
        for f in range(n):
            me = B.build(boss, anim, f, layer, name=f"{sheet}_{anim}{f}")
            ob = C.link(bpy.data.objects.new(f"{sheet}_{anim}{f}", me))
            u = (f - (cols - 1) / 2) * cu + du
            v = ((rows - 1) / 2 - r) * cv + dv
            ob.location = C.screen_to_ground(u, v)
    C.oblique_camera(max(cols * cu, rows * cv))
    C.render_to(os.path.join(out_dir, sheet + ".png"))
    wings = layer == "wings"
    meta = {"name": sheet, "cell": [cw, ch], "anchor": list(anchor), "anims": meta_anims,
            "outline": not wings, "glowSplit": not wings, "ss": ss}
    if wings:
        meta["overlayOf"] = boss
        meta["alpha"] = WING_ALPHA
    with open(os.path.join(out_dir, sheet + ".json"), "w", encoding="utf-8", newline="\n") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=1)


def save_showcase(boss, path, ppu):
    """Blender で開いて確かめる見本。左にふだんの動き、右に攻撃。再生ボタンで動く。"""
    C.reset_scene()
    scene = bpy.context.scene
    cw, ch, anims, cols, rows = layout(boss)
    main = B.SHOWCASE_ANIM[boss]
    total = 1
    for _, n, _ in anims:
        total = total * n // math.gcd(total, n)
    scene.frame_start, scene.frame_end = 1, total
    scene.render.fps = next(fps for a, _, fps in anims if a == main)
    step = cw / ppu
    for i, (anim, n, _) in enumerate(anims):
        for f in range(n):
            ob = C.link(bpy.data.objects.new(f"{boss}_{anim}{f}", B.build(boss, anim, f, "all")))
            ob.location = ((i - (len(anims) - 1) / 2) * step, 0, 0)
            for t in range(1, total + 1):
                hide = (t - 1) % n != f
                ob.hide_render = hide
                ob.hide_viewport = hide
                ob.keyframe_insert("hide_render", frame=t)
                ob.keyframe_insert("hide_viewport", frame=t)
    C.set_resolution(len(anims) * cw * 4, ch * 4)
    C.oblique_camera(len(anims) * step)
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print("  saved:", path, flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--ss", type=int, default=BOSS_SS)    # build.py から渡されるが、ボスは BOSS_SS を使う
    p.add_argument("--ppu", type=float, default=20.0)
    p.add_argument("--blend", default="")
    p.add_argument("--only", default=",".join(B.BOSSES))
    a = p.parse_args(argv)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    names = [n for n in a.only.split(",") if n]
    for boss in names:
        print("== boss", boss, flush=True)
        anchor = find_anchor(boss, a.ppu)
        render_sheet(boss, "body", boss, out, a.ppu, anchor)
        if B.BOSSES[boss].get("wings"):
            render_sheet(boss, "wings", boss + "_wings", out, a.ppu, anchor)
    if a.blend:
        bl = os.path.abspath(a.blend)
        os.makedirs(bl, exist_ok=True)
        for boss in names:
            print("== blend", boss, flush=True)
            save_showcase(boss, os.path.join(bl, f"boss_{boss}.blend"), a.ppu)


main()
