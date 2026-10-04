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
    # --- フェーズ2：敵・小物・ボス・エリアの地面 ---
    "termite": ["#0d0a08", "#1e1712", "#33281e", "#4d3d2c", "#6a5538", "#8a7048"],   # シロアリの体
    "termhead": ["#0e0806", "#24120a", "#3c1d0e", "#5a2c12", "#7a3e18", "#9a5222"],  # シロアリの頭（兵隊）
    "amber":   ["#0c0805", "#1f1408", "#36220c", "#553410", "#784a14", "#9c6418"],   # ゴミムシ・スズメバチの橙
    "silk":    ["#0f0f12", "#22222a", "#383842", "#52525e", "#70707e", "#9494a2"],   # 繭・クモの糸
    "water":   ["#05080c", "#0a121a", "#112030", "#1a3044", "#28465e", "#3e6680"],   # 水たまり
    "mantis":  ["#070906", "#10160c", "#1c2614", "#2c3a1c", "#435626", "#5e7432"],   # カマキリの緑
    "clay":    ["#0f0b08", "#201710", "#332418", "#483322", "#5e432c", "#765638"],   # 巣の土
    "grass":   ["#060904", "#0d1508", "#16220d", "#213214", "#2f441b", "#3e5622"],   # 庭の草・森のコケ
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
    "blue":   [WHITE_CORE, "#3a8cff", "#1446a8"],     # 良いゲート
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

assert len(PALETTE) <= 128, "パレットは128色までです"


def rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
