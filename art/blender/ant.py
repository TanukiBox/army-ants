"""アリの3Dモデル（部品の組み立て）と歩行アニメーション。

1匹のアリは「どの武器を何Lvで持つか」「甲殻装甲が何Lvか」で形が決まります。
  Spec(weapon=None,      wlv=0, armor=0) … 通常のアリ
  Spec(weapon="mandible", wlv=2)        … アギトアリ Lv2（顎型）
  Spec(weapon="fire",     wlv=1)        … ヒアリ Lv1（毒弾型）
  Spec(weapon="bullet",   wlv=3)        … サシハリアリ Lv3（毒針型）
  Spec(weapon="bomb",     wlv=1)        … 自爆アリ Lv1（爆発型）
  Spec(armor=3)                         … 甲殻装甲 Lv3（防具）

長さの単位：通常のアリの体長がおよそ 1.0。頭が +Y（前）、上が +Z、地面が z=0。
"""
import math
from dataclasses import dataclass

from mathutils import Vector, Matrix

import common as C

# 武器ごとの光る色（模様）と目の色
PATTERN_GLOW = {None: "red", "mandible": "ember", "fire": "red", "bullet": "purple", "bomb": "yellow"}
EYE_GLOW = {None: "red", "mandible": "ember", "fire": "green", "bullet": "purple", "bomb": "yellow"}
ARMOR_GLOW = "cyan"
# Lv ごとの体の大きさ（指示書 3-2「Lvごとに体が少し大きくなる」）
LV_SCALE = {0: 1.0, 1: 1.06, 2: 1.13, 3: 1.21}

WALK_FRAMES = 8


@dataclass(frozen=True)
class Spec:
    weapon: str = None   # None / "mandible" / "fire" / "bullet" / "bomb"
    wlv: int = 0
    armor: int = 0

    @property
    def name(self):
        parts = []
        if self.weapon:
            parts.append(f"{self.weapon}{self.wlv}")
        if self.armor:
            parts.append(f"armor{self.armor}")
        return "_".join(parts) or "base"

    @property
    def lv(self):
        return max(self.wlv, self.armor)


def spec_from_name(name):
    w, wl, a = None, 0, 0
    for p in name.split("_"):
        if p == "base":
            continue
        if p.startswith("armor"):
            a = int(p[5:])
        else:
            w, wl = p[:-1], int(p[-1])
    return Spec(w, wl, a)


# ---------------------------------------------------------------------------
# 体の寸法（武器・防具で少しずつ変える）
# ---------------------------------------------------------------------------
def proportions(s: Spec):
    P = dict(
        head=dict(y=0.335, z=0.150, r=(0.128, 0.128, 0.094)),
        pron=dict(y=0.150, z=0.165, r=(0.084, 0.090, 0.080)),   # 前胸（胸の前のふくらみ）
        prop=dict(y=0.030, z=0.150, r=(0.066, 0.112, 0.066)),   # 胸の後ろ側
        pet=[dict(y=-0.118, z=0.150, r=(0.040, 0.036, 0.056))],  # 腹柄（くびれの節）
        gas=dict(y=-0.330, z=0.165, r=(0.165, 0.198, 0.140)),   # 腹
        legs=[  # (付け根 y, 向き[度], 太もも, すね, 先)
            (0.150, 55.0, 0.17, 0.17, 0.08),
            (0.055, 6.0, 0.18, 0.19, 0.08),
            (-0.030, -38.0, 0.21, 0.23, 0.09),
        ],
        leg_r=(0.036, 0.029, 0.022, 0.016),
        antenna=(0.15, 0.19),
    )
    if s.weapon == "mandible":       # アギトアリ：細長い頭
        P["head"] = dict(y=0.350, z=0.150, r=(0.118, 0.150, 0.090))
    elif s.weapon == "bullet":       # サシハリアリ：がっしり大きい
        P["head"] = dict(y=0.350, z=0.160, r=(0.142, 0.138, 0.100))
        P["pron"] = dict(y=0.155, z=0.175, r=(0.095, 0.098, 0.090))
        P["prop"] = dict(y=0.030, z=0.160, r=(0.074, 0.120, 0.074))
        P["gas"] = dict(y=-0.345, z=0.170, r=(0.172, 0.215, 0.148))
        P["leg_r"] = (0.040, 0.032, 0.024, 0.017)
    elif s.weapon == "fire":         # ヒアリ：腹柄の節が2つ
        P["pet"] = [dict(y=-0.105, z=0.150, r=(0.036, 0.032, 0.050)),
                    dict(y=-0.165, z=0.150, r=(0.046, 0.036, 0.048))]
        P["gas"] = dict(y=-0.370, z=0.160, r=(0.160, 0.190, 0.135))
    elif s.weapon == "bomb":         # 自爆アリ：Lv が上がるほど腹がふくらむ
        k = {1: 1.18, 2: 1.38, 3: 1.60}[s.wlv]
        g = P["gas"]
        ry = g["r"][1] * (1 + (k - 1) * 0.55)
        P["gas"] = dict(y=-0.14 - ry, z=0.165 + (k - 1) * 0.05,
                        r=(g["r"][0] * k, ry, g["r"][2] * k))
    if s.armor >= 2:
        r = P["leg_r"]
        P["leg_r"] = (r[0] * 1.25, r[1] * 1.22, r[2] * 1.15, r[3])
    return P


# 光る模様の位置（腹の前 +1 〜 後ろ -1 のどこに帯を入れるか）。
# 帯の幅は約1ドット。小さな絵でも潰れないよう、Lv3 でも腹の帯は2本まで。
BAND_T = {0: (), 1: (0.0,), 2: (0.34, -0.30), 3: (0.34, -0.30)}
BAND_HALF = 0.030          # 帯の半分の幅（ドット絵で約1ドット）
LINE_HALF = 0.020          # 背中の線の半分の幅


def _band_fn(g, ts, mat, half=BAND_HALF):
    ys = [g["y"] + t * g["r"][1] for t in ts]

    def fn(ring, f):
        y = f.calc_center_median().y
        return mat if any(abs(y - yk) < half for yk in ys) else None
    return fn


def _midline_fn(mat, top_z, half=LINE_HALF):
    """背中の真ん中の線（上から見える所だけ）。"""
    def fn(ring, f):
        c = f.calc_center_median()
        return mat if abs(c.x) < half and c.z > top_z else None
    return fn


# ---------------------------------------------------------------------------
# 組み立て
# ---------------------------------------------------------------------------
def build(s: Spec, frame=0, frames=WALK_FRAMES, name=None):
    """1コマ分のアリのメッシュを作る（frame で脚と触角の位置が変わる）。"""
    P = proportions(s)
    parts = C.Parts()
    metal = s.armor >= 3
    shell = C.toon_material("metal" if metal else "chitin", "metal" if metal else "chitin")
    belly = C.toon_material("metal" if metal else "crimson", "metal" if metal else "crimson")
    pglow = C.glow_material("glow_" + PATTERN_GLOW[s.weapon], PATTERN_GLOW[s.weapon])
    if s.weapon is None and not s.armor:   # ふつうのアリの目は控えめ（群れが赤い粒だらけにならないように）
        eglow = C.glow_material("glow_eye_dim", "red", dim=True)
    else:
        eglow = C.glow_material("glow_" + EYE_GLOW[s.weapon], EYE_GLOW[s.weapon])
    aglow = C.glow_material("glow_" + ARMOR_GLOW, ARMOR_GLOW)
    phase = 2 * math.pi * frame / frames

    h, pr, pp, g = P["head"], P["pron"], P["prop"], P["gas"]

    # --- 頭・目 ---------------------------------------------------------------
    parts.add(C.ellipsoid((0, h["y"], h["z"]), h["r"], 18, 12), shell)
    ex, ey = h["r"][0] * 0.78, h["y"] + h["r"][1] * 0.22
    for sx in (-1, 1):
        parts.add(C.ellipsoid((sx * ex, ey, h["z"] + 0.030), (0.034, 0.040, 0.032), 10, 6), eglow)

    # --- 胸・くびれ ------------------------------------------------------------------
    parts.add(C.ellipsoid((0, pr["y"], pr["z"]), pr["r"], 16, 10), shell)
    parts.add(C.ellipsoid((0, pp["y"], pp["z"]), pp["r"], 14, 10), shell)
    if s.weapon and s.wlv >= 3:       # Lv3：胸の両肩に光る点
        for sx in (-1, 1):
            parts.add(C.ellipsoid((sx * pr["r"][0] * 0.62, pr["y"] - 0.01, pr["z"] + pr["r"][2] * 0.62),
                                  (0.030, 0.034, 0.026), 10, 6), pglow)
    neck_y = h["y"] - h["r"][1] * 0.85
    parts.add(C.tube([(0, pr["y"] + 0.04, pr["z"]), (0, neck_y, h["z"] - 0.01)], [0.040, 0.040], 8), shell)
    waist = [(0, pp["y"] - pp["r"][1] * 0.8, pp["z"] - 0.01)]
    for n in P["pet"]:
        parts.add(C.ellipsoid((0, n["y"], n["z"]), n["r"], 10, 8), shell)
        waist.append((0, n["y"], n["z"] - 0.01))
    waist.append((0, g["y"] + g["r"][1] * 0.85, g["z"] - 0.02))
    parts.add(C.tube(waist, [0.026] * len(waist), 8), shell)

    # --- 腹 ------------------------------------------------------------------------
    ts = BAND_T[s.wlv] if s.weapon else ()
    gas_fn = _band_fn(g, ts, pglow) if ts else None
    if s.weapon == "fire":
        # ヒアリ：腹が赤く光る。Lv1 は腹の先、Lv2 は後ろ半分、Lv3 は腹ぜんたい（節の境目だけ暗い）
        lit_from = {1: -0.55, 2: -0.05, 3: 0.75}[s.wlv]
        seams = [g["y"] + t * g["r"][1] for t in {1: (), 2: (-0.45,), 3: (0.25, -0.30)}[s.wlv]]

        def gas_fn(ring, f, lit_from=lit_from, seams=seams):
            y = f.calc_center_median().y
            if (y - g["y"]) / g["r"][1] > lit_from:
                return None
            return None if any(abs(y - sy) < BAND_HALF * 0.9 for sy in seams) else pglow
    elif s.weapon == "bomb":
        # 自爆アリ：ふくらんだ腹の板の間（のびた膜）が黄色く光る
        ts = {1: (0.05,), 2: (0.38, -0.22), 3: (0.50, 0.05, -0.42)}[s.wlv]
        gas_fn = _band_fn(g, ts, pglow, half=BAND_HALF * (1.0 + 0.08 * s.wlv))
    parts.add(C.ellipsoid((0, g["y"], g["z"]), g["r"], 20, 14), belly, gas_fn)

    # --- 武器の部品 ---------------------------------------------------------------
    tip_y = g["y"] - g["r"][1]
    if s.weapon == "mandible":
        _trap_jaws(parts, s, h, shell, pglow)
    else:
        _mandibles(parts, h, shell)
    if s.weapon == "bullet":
        L = {1: 0.14, 2: 0.19, 3: 0.24}[s.wlv]
        r0 = {1: 0.040, 2: 0.046, 3: 0.052}[s.wlv]
        z = g["z"] - 0.02
        pts = [(0, tip_y + 0.03, z), (0, tip_y - L * 0.35, z - 0.012),
               (0, tip_y - L * 0.75, z - 0.03), (0, tip_y - L, z - 0.05)]
        parts.add(C.tube(pts, [r0, r0 * 0.75, r0 * 0.40, 0.0], 10), pglow)
    if s.weapon == "fire":
        z = g["z"] - 0.02
        parts.add(C.tube([(0, tip_y + 0.02, z), (0, tip_y - 0.05, z - 0.02), (0, tip_y - 0.07, z - 0.03)],
                         [0.020, 0.014, 0.0], 8), shell)
        if s.wlv >= 2:   # 針の先の緑の毒のしずく
            parts.add(C.ellipsoid((0, tip_y - 0.09, z - 0.03), (0.036, 0.036, 0.036), 10, 6),
                      C.glow_material("glow_green", "green"))

    # --- 甲殻装甲 ------------------------------------------------------------------
    if s.armor:
        _armor(parts, s, P, shell, aglow)

    # --- 脚 ------------------------------------------------------------------------
    leg_r = P["leg_r"]
    for i, (ly, yaw, fem, tib, tar) in enumerate(P["legs"]):
        for side in (-1, 1):
            # 3本ずつ交互に動かす（左前・右中・左後 と 右前・左中・右後）
            group = (i + (0 if side < 0 else 1)) % 2
            u = phase + math.pi * group
            swing = math.radians(20.0) * math.cos(u)
            lift = 0.06 * max(0.0, -math.sin(u))
            parts.add(_leg((side * 0.055, ly, 0.125), side, math.radians(yaw) + swing, fem, tib, tar,
                           lift, leg_r), shell)

    # --- 触角 ------------------------------------------------------------------------
    for side in (-1, 1):
        sway = math.radians(9.0) * math.sin(phase + (0 if side < 0 else math.pi * 0.5))
        parts.add(_antenna(h, side, sway, P["antenna"]), shell)

    me = parts.to_mesh(name or f"ant_{s.name}_{frame}")
    sc = LV_SCALE[s.lv]
    me.transform(Matrix.Diagonal((sc, sc, sc, 1.0)))
    return me


def _rot_z(v, a):
    c, s_ = math.cos(a), math.sin(a)
    return Vector((v.x * c - v.y * s_, v.x * s_ + v.y * c, v.z))


def _leg(attach, side, yaw, fem, tib, tar, lift, radii):
    A = Vector(attach)
    d = Vector((side * math.cos(yaw), math.sin(yaw), 0.0))
    K = A + d * (fem * 0.90) + Vector((0, 0, fem * 0.40))           # ひざ（体と同じくらいの高さ）
    drop = K.z - (lift + 0.03)
    horiz = math.sqrt(max(tib * tib - drop * drop, 0.0004))
    F = K + d * horiz
    F.z = lift + 0.03
    T = F + d * (tar * 0.95)
    T.z = lift * 0.6
    return C.tube([A, K, F, T], list(radii), 7)


def _antenna(h, side, sway, lens):
    scape, funi = lens
    base = Vector((side * 0.05, h["y"] + h["r"][1] * 0.55, h["z"] + 0.05))
    d1 = _rot_z(Vector((side * 0.62, 0.50, 0.60)).normalized(), side * sway * 0.6)
    E = base + d1 * scape
    d2 = _rot_z(Vector((side * 0.42, 0.90, -0.12)).normalized(), side * sway)
    M = E + d2 * (funi * 0.6)
    T = E + d2 * funi + Vector((0, 0, -0.02))
    return C.tube([base, E, M, T], [0.020, 0.018, 0.019, 0.024], 6)


def _mandibles(parts, h, mat):
    """ふつうの短い顎（前へ出て、内側へ曲がる）。"""
    fy = h["y"] + h["r"][1] * 0.85
    z = h["z"] - 0.03
    for side in (-1, 1):
        pts = [(side * 0.055, fy - 0.01, z), (side * 0.068, fy + 0.05, z - 0.005),
               (side * 0.040, fy + 0.10, z - 0.01), (side * 0.010, fy + 0.115, z - 0.012)]
        parts.add(C.tube(pts, [0.028, 0.024, 0.017, 0.006], 7), mat)


def _trap_jaws(parts, s, h, mat, glow):
    """アギトアリの長い顎。Lv が上がるほど長く・太く・先が鋭くなる。
    前へまっすぐ突き出し、先に内向きの牙。Lv2 から牙が光り、Lv3 は内側にギザギザ。"""
    L = {1: 0.21, 2: 0.27, 3: 0.33}[s.wlv]
    r0 = {1: 0.046, 2: 0.053, 3: 0.060}[s.wlv]
    fy = h["y"] + h["r"][1] * 0.74
    z = h["z"] - 0.02
    for side in (-1, 1):
        # 外へ開いてから前へ伸び、先は内側へ曲がる（はさみの形）
        out = Vector((side * math.sin(math.radians(34)), math.cos(math.radians(34)), 0.0))
        fwd = Vector((side * math.sin(math.radians(4)), 1.0, 0.0)).normalized()
        inward = Vector((-side * 1.0, 0.35, 0.0)).normalized()
        B = Vector((side * 0.05, fy, z))
        M = B + out * (L * 0.38)
        E = M + fwd * (L * 0.55)
        hook = E + inward * (0.05 + 0.012 * s.wlv) + fwd * 0.03     # 先の内向きの牙
        parts.add(C.tube([B, M, E], [r0, r0 * 0.92, r0 * 0.78], 8), mat)
        parts.add(C.tube([E - fwd * 0.012, hook], [r0 * 0.78, 0.0], 7), glow if s.wlv >= 2 else mat)
        if s.wlv >= 3:   # 内側のギザギザ
            for t in (0.35, 0.75):
                P0 = M + fwd * (L * 0.55 * t)
                parts.add(C.tube([P0, P0 + inward * 0.045 + fwd * 0.02], [r0 * 0.6, 0.0], 5), mat)


def _armor(parts, s, P, shell, glow):
    """甲殻装甲：外骨格に厚い板と棘を足す。Lv3 は金属の光沢と光る線。
    光る線：Lv1 頭の線 / Lv2 ＋胸の線 / Lv3 ＋腹の板の線と棘の先"""
    h, pr, pp, g = P["head"], P["pron"], P["prop"], P["gas"]
    lv = s.armor
    th = {1: 1.10, 2: 1.15, 3: 1.19}[lv]

    def plate(c, r, lit=False, rings=10):
        rr = (r[0] * th, r[1] * th * 0.96, r[2] * th * 0.92)
        bm = C.ellipsoid(c, rr, 18, rings)
        C.dome(bm, c[2] - rr[2] * 0.25)
        parts.add(bm, shell, _midline_fn(glow, c[2] + rr[2] * 0.5) if lit else None)

    plate((0, h["y"] - 0.005, h["z"] + 0.012), h["r"], lit=True)            # 頭の盾
    plate((0, pr["y"], pr["z"] + 0.012), pr["r"], lit=lv >= 2)               # 前胸の盾
    plate((0, pp["y"], pp["z"] + 0.010), pp["r"])                            # 胸の後ろの盾
    for t in (0.50, 0.0, -0.50):                                            # 腹の背板（3枚が重なる）
        cy = g["y"] + g["r"][1] * t * 0.72
        rr = (g["r"][0] * (1.0 - 0.12 * abs(t)), g["r"][1] * 0.46, g["r"][2] * (1.0 - 0.1 * abs(t)))
        plate((0, cy, g["z"] + 0.02), rr, lit=(lv >= 3 and t == 0.0))
    if lv >= 2:   # 棘：前胸は前・外へ、胸の後ろは後ろ・上へ
        for side in (-1, 1):
            b = Vector((side * pr["r"][0] * 0.8, pr["y"] + 0.02, pr["z"] + 0.04))
            parts.add(C.tube([b, b + Vector((side * 0.08, 0.05, 0.04))], [0.026, 0.0], 6), shell)
            b = Vector((side * pp["r"][0] * 0.6, pp["y"] - pp["r"][1] * 0.6, pp["z"] + 0.04))
            L = 0.11 if lv == 2 else 0.14
            parts.add(C.tube([b, b + Vector((side * 0.05, -L * 0.7, L * 0.7))], [0.028, 0.0], 6),
                      glow if lv >= 3 else shell)
