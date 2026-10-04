"""コマを並べたシート（敵・小物・ボス）をまとめてドット絵にする。

Blender 側のスクリプトは、元画像 <名前>.png と一緒に <名前>.json を書き出す：
  {
    "name": "beetle",
    "cell": [48, 48],            … 1コマの大きさ（ドット）
    "anchor": [24, 30],          … 足元（地面に立つ点）の位置（コマの左上から）
    "anims": {"walk": {"row": 0, "frames": 4, "fps": 8}, ...},
    "outline": true,             … 1px の暗い輪郭をつけるか
    "glowSplit": true,           … 光る部分を発光用の画像に分けるか
    "ss": 8                      … 元画像が何倍の大きさか（省略すると build.py の SS）
  }
convert_dir() は、そのフォルダの全部の json を読んで変換し、sprites.json に入れる情報を返す。
"""
import glob
import json
import os

from . import pixelate


def convert_dir(renders_dir, out_dir, rel_prefix, ss):
    entries = {}
    made = []
    for jpath in sorted(glob.glob(os.path.join(renders_dir, "*.json"))):
        meta = json.load(open(jpath, encoding="utf-8"))
        name = meta["name"]
        src = os.path.join(renders_dir, name + ".png")
        col, glow = pixelate.pixelate(src, meta.get("ss", ss), with_outline=meta.get("outline", True),
                                      coverage=meta.get("coverage", 0.34),
                                      glow_split=meta.get("glowSplit", True))
        os.makedirs(os.path.join(out_dir, rel_prefix), exist_ok=True)
        rel = f"{rel_prefix}/{name}.png"
        pixelate.save_png(col, os.path.join(out_dir, rel))
        made.append(rel)
        entry = {k: v for k, v in meta.items() if k not in ("name", "outline", "glowSplit", "coverage", "ss")}
        entry["file"] = rel
        if glow.getbbox():   # 光る部分があるときだけ
            grel = f"{rel_prefix}/{name}_glow.png"
            pixelate.save_png(glow, os.path.join(out_dir, grel))
            entry["glow"] = grel
            made.append(grel)
        entries[name] = entry
        print("  ドット絵:", name, flush=True)
    return entries, made
