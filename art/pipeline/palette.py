"""ゲーム全体で共通の固定パレット（暗め）。

Blender の中（マテリアルの色）と、ドット絵変換（減色）の両方から読み込みます。
- RAMPS … 光の当たり方で塗り分ける「段」の色（暗い → 明るい の順）
- GLOWS … 光る部分の色。明るい色はここにしか使わない（指示書 3-3）
- 色を変えたら `python build.py --skip-render` ではなく、`python build.py` で作り直します
  （Blender の中の色も変わるため）。
"""

OUTLINE = "#060408"

# 甲殻などの塗り分け：[影, 地, 明, 縁の光, つや, つやの芯]
RAMPS = {
    # 黒い甲殻（頭・胸・脚）
    "chitin":  ["#070506", "#0e0a0c", "#191215", "#36131c", "#5e1b27", "#8c2c37"],
    # 深紅の甲殻（腹）
    "crimson": ["#070506", "#12080b", "#230b11", "#43111b", "#701c29", "#9e323d"],
    # 甲殻装甲 Lv3：金属
    "metal":   ["#090b10", "#131822", "#202838", "#36435a", "#5e7394", "#a6badb"],
    # 地面（背景の部品）
    "soil":    ["#0e0b0a", "#16110e", "#1f1813", "#2a2019", "#352920", "#433428"],
    "leaf":    ["#170d09", "#24130c", "#341b10", "#4a2614", "#5f3218", "#76401e"],
    "leafred": ["#170b09", "#2a100c", "#3e1610", "#561d14", "#6c2618", "#86301c"],
    "leafolv": ["#121109", "#1d1b0f", "#2a2814", "#39361a", "#4a4520", "#5c5627"],
    "stone":   ["#101014", "#1a1a20", "#26252d", "#33323b", "#45434e", "#5a5764"],
}

# 光る色：[芯, 本体, 深い色]
WHITE_CORE = "#fff6ec"
GLOWS = {
    "red":    [WHITE_CORE, "#ff3a2a", "#a8141c"],
    "ember":  [WHITE_CORE, "#ff8a24", "#b8420e"],
    "green":  [WHITE_CORE, "#5cff3a", "#1c9e28"],
    "purple": [WHITE_CORE, "#b85cff", "#6422c0"],
    "yellow": [WHITE_CORE, "#ffd420", "#b88008"],
    "cyan":   [WHITE_CORE, "#36dcff", "#1080b0"],
}


def _unique(seq):
    out = []
    for c in seq:
        if c not in out:
            out.append(c)
    return out


GLOW_COLORS = _unique(c for g in GLOWS.values() for c in g)
BODY_COLORS = _unique(c for r in RAMPS.values() for c in r)
PALETTE = _unique([OUTLINE] + BODY_COLORS + GLOW_COLORS)

assert len(PALETTE) <= 64, "パレットは64色までです"


def rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
