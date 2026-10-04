"""すべての絵を作り直すコマンド。

  python build.py                 … Blender でレンダリング → ドット絵化 → ゲームの素材フォルダへ
  python build.py --only ants     … 一部だけ（ants / ground / props / bosses をカンマ区切り）
  python build.py --skip-render   … レンダリングを省略（減色・ドット化のやり直しだけ）

できるもの（リポジトリの assets/sprites/ に入る）：
  ants/<種類>.png        アリのスプライトシート（横 = 歩行8コマ、縦 = 向き8方向）
  ants/<種類>_glow.png   同じ並びの「発光用」の画像（光る部分だけ）
  ground/soil_<エリア>.png  土のタイル（すき間なく並べられる）
  ground/decor.png       落ち葉・小石・小枝・草・キノコなど
  props/<名前>.png       敵・繭・巣・石・水たまり（コマを並べたシート）
  bosses/<名前>.png      ボス（コマを並べたシート）
  sprites.json           上の絵の一覧と大きさ（ゲームはこれを読む）
  checksums.txt          全画像の指紋（作り直して変化がなければ同じ画像）
Blender で開ける見本ファイルは art/blend/ に保存されます。
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

from pipeline.blender_path import find_blender
from pipeline import pixelate, sheets
from pipeline.palette import PALETTE, GLOWS

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
BUILD = os.path.join(ROOT, "build")           # 途中のファイル（Git には入れない）
RENDERS = os.path.join(BUILD, "renders")
BLEND = os.path.join(ROOT, "blend")           # Blender で開ける見本
OUT = os.path.join(REPO, "assets", "sprites")

SS = 8           # 何倍の大きさで描いてから縮めるか
PPU = 20.0       # 長さ 1.0（ふつうのアリの体長）が何ドットか
ANT_CELL = 44    # アリ1コマのマスの大きさ（ドット）
TILE = 256       # 土のタイルの大きさ
DECOR_CELL = 64  # 落ち葉などのマスの大きさ

WEAPONS = ["mandible", "fire", "bullet", "bomb"]
# 武器（なし＋4種×Lv1〜3）× 甲殻装甲（なし＋Lv1〜3）の全部の組み合わせ
_W = [""] + [f"{w}{lv}" for w in WEAPONS for lv in (1, 2, 3)]
ANT_VARIANTS = []
for _a in range(4):
    for _w in _W:
        _n = "_".join(p for p in (_w, f"armor{_a}" if _a else "") if p) or "base"
        ANT_VARIANTS.append(_n)
AREAS = ["garden", "forest", "hive"]
JOBS = ["ants", "ground", "props", "bosses"]


def run_blender(script, args):
    blender = find_blender()
    if not blender:
        sys.exit("Blender が見つかりません。README.md の「困ったとき」を見てください。")
    cmd = [blender, "-b", "--factory-startup", "--python-exit-code", "1",
           "-P", os.path.join(ROOT, "blender", script), "--"] + args
    print("Blender を起動します:", script, flush=True)
    t0 = time.time()
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding="utf-8", errors="replace")
    for line in proc.stdout.splitlines():
        if line.startswith(("==", "  saved", "Traceback", "  File")) or "Error" in line:
            print(line)
    if proc.returncode != 0:
        print(proc.stdout[-4000:])
        sys.exit("Blender でエラーが起きました（上のメッセージを見てください）。")
    print(f"  完了（{time.time() - t0:.0f} 秒）")


def decor_names():
    src = open(os.path.join(ROOT, "blender", "ground.py"), encoding="utf-8").read()
    block = src.split("DECOR = [", 1)[1]
    return re.findall(r'^\s+\("(\w+)", lambda', block, re.M)


def render(jobs):
    common = ["--ss", str(SS), "--ppu", str(PPU), "--blend", BLEND]
    if "ants" in jobs:
        run_blender("render_ants.py", ["--out", os.path.join(RENDERS, "ants"),
                                       "--variants", ",".join(ANT_VARIANTS),
                                       "--cell", str(ANT_CELL)] + common)
    if "ground" in jobs:
        run_blender("render_ground.py", ["--out", os.path.join(RENDERS, "ground"),
                                         "--tile", str(TILE), "--cell", str(DECOR_CELL),
                                         "--areas", ",".join(AREAS)] + common)
    if "props" in jobs:
        run_blender("render_props.py", ["--out", os.path.join(RENDERS, "props")] + common)
    if "bosses" in jobs:
        run_blender("render_bosses.py", ["--out", os.path.join(RENDERS, "bosses")] + common)


def convert(jobs):
    made = []
    mpath = os.path.join(OUT, "sprites.json")
    manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {}

    def save(img, rel):
        dst = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        pixelate.save_png(img, dst)
        made.append(rel)

    if "ants" in jobs:
        for n in ANT_VARIANTS:
            # 輪郭あり：群れで重なっても1匹ずつの形が分かるように
            col, glow = pixelate.pixelate(os.path.join(RENDERS, "ants", n + ".png"), SS,
                                          with_outline=True, glow_split=True)
            _check_margin(col, ANT_CELL, n)
            save(col, f"ants/{n}.png")
            save(glow, f"ants/{n}_glow.png")
        print(f"  ドット絵: アリ {len(ANT_VARIANTS)} 種類", flush=True)
        manifest["ant"] = {"cell": ANT_CELL, "frames": 8, "dirs": 8, "anchor": [ANT_CELL // 2, ANT_CELL // 2],
                           "dirOrder": "0=上(奥) 1=右上 2=右 3=右下 4=下 5=左下 6=左 7=左上",
                           "variants": ANT_VARIANTS}
    if "ground" in jobs:
        soils = {}
        for area in AREAS:
            soil, _ = pixelate.pixelate(os.path.join(RENDERS, "ground", f"soil_{area}.png"), SS, coverage=0.5)
            save(soil, f"ground/soil_{area}.png")
            soils[area] = f"ground/soil_{area}.png"
        decor, dglow = pixelate.pixelate(os.path.join(RENDERS, "ground", "decor.png"), SS,
                                         with_outline=True, coverage=0.5, glow_split=True)
        save(decor, "ground/decor.png")
        save(dglow, "ground/decor_glow.png")
        print("  ドット絵: 地面", flush=True)
        manifest["soil"] = {"files": soils, "size": TILE}
        manifest["decor"] = {"file": "ground/decor.png", "glow": "ground/decor_glow.png",
                             "cell": DECOR_CELL, "cols": 8, "items": decor_names()}
    for job in ("props", "bosses"):
        if job in jobs:
            entries, m = sheets.convert_dir(os.path.join(RENDERS, job), OUT, job, SS)
            made += m
            manifest[job] = entries

    manifest["note"] = "art/build.py が自動で書き出すファイル（手で書きかえない）"
    manifest["glows"] = {k: v[1] for k, v in GLOWS.items()}
    manifest["palette"] = PALETTE
    with open(mpath, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # 同じ入力から同じ画像ができているか確かめるための指紋（SHA-256）
    allfiles = []
    for dirpath, _, files in os.walk(OUT):
        for fn in files:
            if fn.endswith(".png"):
                allfiles.append(os.path.relpath(os.path.join(dirpath, fn), OUT).replace("\\", "/"))
    with open(os.path.join(OUT, "checksums.txt"), "w", encoding="utf-8", newline="\n") as f:
        for rel in sorted(allfiles):
            h = hashlib.sha256(open(os.path.join(OUT, rel), "rb").read()).hexdigest()
            f.write(f"{h}  {rel}\n")
    print(f"ドット絵 {len(made)} 個を assets/sprites/ に書き出しました。")


def _check_margin(img, cell, name):
    """マスのふちまで絵がはみ出していないか（はみ出すと隣のコマと重なる）。"""
    import numpy as np
    a = np.asarray(img)[..., 3] > 0
    H, W = a.shape
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            c = a[y:y + cell, x:x + cell]
            if c[0].any() or c[-1].any() or c[:, 0].any() or c[:, -1].any():
                print(f"  注意: {name} のコマ ({x // cell}, {y // cell}) がマスのふちに届いています")
                return


def main():
    p = argparse.ArgumentParser(description="ARMY ANTS のドット絵を作り直す")
    p.add_argument("--skip-render", action="store_true", help="Blender のレンダリングを省略する")
    p.add_argument("--only", default=",".join(JOBS), help="作る種類（ants / ground / props / bosses）")
    a = p.parse_args()
    jobs = set(a.only.split(","))
    if not a.skip_render:
        render(jobs)
    convert(jobs)


if __name__ == "__main__":
    main()
