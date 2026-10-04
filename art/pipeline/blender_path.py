"""Blender の場所を探す（Oh!Edo Taco Tuesday!! から流用）。

見つからないときは、環境変数 BLENDER に blender.exe の場所を入れてください。
"""
import glob
import os
import re
import shutil


def find_blender():
    env = os.environ.get("BLENDER")
    if env and os.path.isfile(env):
        return env
    candidates = glob.glob(r"C:\Program Files\Blender Foundation\Blender *\blender.exe")

    def version(p):
        m = re.search(r"Blender (\d+)\.(\d+)", p)
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

    if candidates:
        return max(candidates, key=version)
    return shutil.which("blender")
