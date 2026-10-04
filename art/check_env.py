"""環境チェック：python check_env.py

  1. Blender をコマンドから実行できるか（バージョンを表示）
  2. 画像処理用の Python ライブラリ（Pillow, numpy）が読み込めるか
"""
import subprocess
import sys

from pipeline.blender_path import find_blender

ok = True

print("1. Blender")
blender = find_blender()
if not blender:
    print("  NG: Blender が見つかりません（README.md の「困ったとき」を見てください）")
    ok = False
else:
    out = subprocess.run([blender, "--version"], capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    print("  OK:", out.strip().splitlines()[0], "(" + blender + ")")

print("2. Python ライブラリ")
try:
    import numpy
    import PIL
    from PIL import Image
    Image.new("RGBA", (2, 2)).resize((4, 4), Image.NEAREST)
    print(f"  OK: Pillow {PIL.__version__} / numpy {numpy.__version__}")
except ImportError as e:
    print("  NG:", e, "→ python -m pip install -r requirements.txt を実行してください")
    ok = False

print("すべてOKです。" if ok else "NG の項目があります。")
sys.exit(0 if ok else 1)
