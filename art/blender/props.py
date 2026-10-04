"""フェーズ2の敵と小物：シロアリ（敵の群れ）・ミイデラゴミムシ（撃ってくる敵）・変異の繭・巣・石・水たまり。

長さの単位はアリと同じ（ふつうのアリの体長がおよそ 1.0）。頭は -Y（画面の下＝プレイヤーの方）を向く。
"""
import math

import bmesh
from mathutils import Vector, Matrix

import common as C
import ant as A


def _rotz(bm, ang):
    C.transform(bm, Matrix.Rotation(ang, 4, "Z"))
    return bm


def _legs(parts, mat, attach_ys, yaws, lens, radii, phase, side_x=0.05, z=0.10, swing_deg=22.0):
    """アリと同じ「3本ずつ交互」の歩き方（頭が +Y 向きのとき）。"""
    for i, (ly, yaw, (fem, tib, tar)) in enumerate(zip(attach_ys, yaws, lens)):
        for side in (-1, 1):
            group = (i + (0 if side < 0 else 1)) % 2
            u = phase + math.pi * group
            swing = math.radians(swing_deg) * math.cos(u)
            lift = 0.05 * max(0.0, -math.sin(u))
            parts.add(A._leg((side * side_x, ly, z), side, math.radians(yaw) + swing, fem, tib, tar, lift, radii), mat)


# ---------------------------------------------------------------------------
# シロアリ（敵の群れ）。働きアリは目がなく淡い色、兵隊は大きな橙の頭と長い顎。
# ---------------------------------------------------------------------------
def termite(kind, frame, frames=8):
    phase = 2 * math.pi * frame / frames
    body = C.toon_material("termite", "termite", light=(0.40, 0.75))
    head_m = C.toon_material("termhead", "termhead")
    parts = C.Parts()
    soldier = kind == "soldier"
    # 胸（3節）と、くびれのない太い腹
    parts.add(C.ellipsoid((0, 0.12, 0.11), (0.075, 0.07, 0.06), 12, 8), body)
    parts.add(C.ellipsoid((0, 0.02, 0.11), (0.07, 0.06, 0.06), 12, 8), body)
    parts.add(C.ellipsoid((0, -0.28, 0.12), (0.13, 0.25, 0.10), 16, 12), body,
              lambda ring, f: head_m if ring in (3, 6, 9) else None)       # 腹の節の筋
    if soldier:
        parts.add(C.ellipsoid((0, 0.33, 0.13), (0.11, 0.17, 0.085), 16, 10), head_m)
        for side in (-1, 1):   # 長い鎌のような顎
            b = Vector((side * 0.04, 0.48, 0.11))
            parts.add(C.tube([b, b + Vector((side * 0.02, 0.14, -0.01)), b + Vector((-side * 0.03, 0.24, -0.02))],
                             [0.030, 0.022, 0.0], 7), head_m)
    else:
        parts.add(C.ellipsoid((0, 0.27, 0.12), (0.10, 0.10, 0.075), 14, 10), body)
        for side in (-1, 1):
            b = Vector((side * 0.035, 0.36, 0.10))
            parts.add(C.tube([b, b + Vector((-side * 0.02, 0.06, -0.01))], [0.022, 0.0], 6), head_m)
    for side in (-1, 1):   # 数珠のようなまっすぐの触角
        sway = math.radians(8.0) * math.sin(phase + (0 if side < 0 else 1.5))
        hy = 0.40 if soldier else 0.32
        b = Vector((side * 0.05, hy, 0.15))
        d = A._rot_z(Vector((side * 0.55, 0.85, 0.1)).normalized(), side * sway)
        parts.add(C.tube([b, b + d * 0.12, b + d * 0.22], [0.018, 0.017, 0.016], 6), body)
    _legs(parts, body, (0.13, 0.04, -0.04), (55.0, 5.0, -40.0),
          [(0.13, 0.15, 0.07), (0.14, 0.16, 0.07), (0.16, 0.18, 0.08)], (0.030, 0.024, 0.018, 0.012), phase,
          side_x=0.055)
    me = parts.to_mesh(f"termite_{kind}_{frame}")
    me.transform(Matrix.Rotation(math.pi, 4, "Z"))     # 頭を -Y（画面の下）へ
    return me


# ---------------------------------------------------------------------------
# ミイデラゴミムシ（撃ってくる敵）。黒い羽に橙の模様。おしりから高温のガスを噴く。
# ---------------------------------------------------------------------------
def beetle(anim, frame):
    shell = C.toon_material("beetle_black", "chitin", spec=(0.80, 0.95))
    amber = C.toon_material("amber", "amber")
    hot = C.glow_material("glow_ember", "ember")
    parts = C.Parts()
    frames = 4
    phase = 2 * math.pi * frame / frames
    # 羽（2枚の甲羅）。橙の斑点は面の位置で塗り分け
    for side in (-1, 1):
        bm = C.ellipsoid((side * 0.13, -0.18, 0.20), (0.15, 0.40, 0.15), 18, 14)
        C.dome(bm, 0.16)

        def spots(ring, f, side=side):
            c = f.calc_center_median()
            for sy in (-0.02, -0.34):
                if (c.x - side * 0.14) ** 2 / 0.008 + (c.y - sy) ** 2 / 0.012 < 1.0:
                    return amber
            return None
        parts.add(bm, shell, spots)
    parts.add(C.ellipsoid((0, -0.18, 0.15), (0.26, 0.40, 0.09), 18, 12), shell)        # 腹（羽の下）
    parts.add(C.ellipsoid((0, 0.30, 0.17), (0.17, 0.12, 0.09), 16, 10), amber)        # 前胸（橙）
    parts.add(C.ellipsoid((0, 0.47, 0.15), (0.12, 0.10, 0.075), 14, 10), amber)       # 頭（橙）
    for side in (-1, 1):
        parts.add(C.ellipsoid((side * 0.09, 0.52, 0.17), (0.035, 0.035, 0.03), 8, 6),
                  C.glow_material("glow_beetle_eye", "ember", dim=True))
        b = Vector((side * 0.05, 0.56, 0.13))
        parts.add(C.tube([b, b + Vector((side * 0.03, 0.08, 0)), b + Vector((-side * 0.03, 0.12, 0))],
                         [0.028, 0.02, 0.0], 6), shell)
        sway = math.radians(10) * math.sin(phase + side)
        d = A._rot_z(Vector((side * 0.6, 0.8, 0.15)).normalized(), sway)
        b = Vector((side * 0.08, 0.53, 0.18))
        parts.add(C.tube([b, b + d * 0.2, b + d * 0.38 + Vector((0, 0, -0.03))], [0.022, 0.02, 0.018], 6), shell)
    walk = anim == "walk"
    _legs(parts, shell, (0.30, 0.10, -0.05), (50.0, 0.0, -35.0),
          [(0.20, 0.20, 0.09), (0.21, 0.22, 0.09), (0.24, 0.25, 0.10)], (0.040, 0.032, 0.024, 0.016),
          phase if walk else 0.0, side_x=0.13, z=0.13, swing_deg=18.0 if walk else 0.0)
    if anim == "shoot":
        # おしりの先を体の下から前へ曲げ、頭の下で光るガスを噴く（だんだん強く）
        k = (frame + 1) / frames
        tip = Vector((0, 0.62 + 0.06 * k, 0.07))
        parts.add(C.ellipsoid(tuple(tip), (0.06 + 0.03 * k, 0.06 + 0.03 * k, 0.05 + 0.02 * k), 10, 8), hot)
        if frame >= 2:
            parts.add(C.ellipsoid((0, 0.78 + 0.04 * k, 0.08), (0.08, 0.10, 0.06), 10, 8), hot)
    me = parts.to_mesh(f"beetle_{anim}_{frame}")
    me.transform(Matrix.Rotation(math.pi, 4, "Z"))
    return me


# ---------------------------------------------------------------------------
# 変異の繭：糸を巻いた繭。中の光（白で描いてゲーム側で変異の色をつける）が割れ目から漏れる。
# 4コマ = 耐久 100% / 66% / 33% / ほぼ0（割れ目が増える）
# ---------------------------------------------------------------------------
def cocoon(stage):
    silk = C.toon_material("silk", "silk", light=(0.45, 0.80), spec=(0.93, 0.99))
    strand = C.toon_material("silk_strand", "silk", light=(0.20, 0.55), spec=(0.90, 0.98))
    light = C.glow_material("glow_white", "white")
    parts = C.Parts()
    H, R = 0.95, 0.27
    # 紡錘形（上下がすぼまる）
    bm = bmesh.new()
    segs, rings = 18, 16
    rows = []
    for i in range(rings + 1):
        t = i / rings
        r = R * math.sin(math.pi * t) ** 0.75 * (1.0 + 0.08 * math.sin(t * 9))
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * j / segs), r * math.sin(2 * math.pi * j / segs),
                                   0.05 + t * H)) for j in range(segs)])
    for a_, b_ in zip(rows, rows[1:]):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((a_[j], a_[k], b_[k], b_[j]))
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts.add(bm, silk)
    # ななめに巻きついた糸
    for k in range(9):
        pts = []
        for i in range(17):
            t = 0.08 + 0.84 * i / 16
            a = (i / 16) * math.pi * 1.4 + k * 0.7
            r = R * math.sin(math.pi * t) ** 0.75 + 0.014
            pts.append((r * math.cos(a), r * math.sin(a), 0.05 + t * H))
        parts.add(C.tube(pts, [0.017] * len(pts), 5, cap=False), strand)
    # 割れ目（中の光が漏れる。白で描いてゲーム側で変異の色をつける）
    zc = 0.05 + H / 2
    cracks = [[(0.0, -R - 0.005, zc + 0.18), (0.04, -R - 0.01, zc + 0.02), (-0.02, -R - 0.005, zc - 0.14)]]
    if stage >= 1:
        cracks.append([(-0.16, -0.22, zc + 0.14), (-0.10, -0.25, zc - 0.02), (-0.17, -0.20, zc - 0.18)])
    if stage >= 2:
        cracks.append([(0.17, -0.21, zc + 0.20), (0.12, -0.24, zc + 0.04), (0.18, -0.19, zc - 0.10)])
        cracks.append([(0.0, -0.18, zc + 0.33), (0.07, -0.14, zc + 0.27)])
    if stage >= 3:
        cracks.append([(-0.05, -0.24, zc - 0.28), (0.06, -0.23, zc - 0.36)])
        cracks.append([(-0.21, -0.12, zc + 0.30), (-0.23, -0.08, zc + 0.12)])
    for c in cracks:
        w = 0.022 + 0.008 * stage
        parts.add(C.tube(c, [w] * len(c), 6), light)
    if stage >= 2:   # 中の光の塊が見える
        parts.add(C.ellipsoid((0.0, -0.17, zc), (0.08, 0.06, 0.16), 10, 8), light)
    me = parts.to_mesh(f"cocoon_{stage}")
    # 地面に横たわらせる（上から見て細長く見えるように）。割れ目は上（カメラ側）へ
    me.transform(Matrix.Translation((0, 0, 0.27)) @ Matrix.Rotation(1.15, 4, "Z")
                 @ Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Translation((0, 0, -zc)))
    return me


# ---------------------------------------------------------------------------
# 巣
# ---------------------------------------------------------------------------
def _mound(parts, mat, base_r, height, seed, rough=0.08, segs=28, rings=14, crater=0.0, grooves=0):
    rng = C.rng_for(seed)
    prof = []
    for i in range(rings + 1):
        t = i / rings
        r = base_r * (1 - t) ** 0.8 + (crater if t > 0.85 else 0)
        z = height * (1 - (1 - t) ** 1.6)
        prof.append((max(r, 0.0), z))
    bm = bmesh.new()
    rows = []
    for r, z in prof:
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * j / segs), r * math.sin(2 * math.pi * j / segs), z))
                     for j in range(segs)])
    for a, b in zip(rows, rows[1:]):
        for j in range(segs):
            k = (j + 1) % segs
            bm.faces.new((a[j], a[k], b[k], b[j]))
    top = bm.verts.new((0, 0, prof[-1][1] - crater * 2))
    for j in range(segs):
        bm.faces.new((rows[-1][j], rows[-1][(j + 1) % segs], top))
    for v in bm.verts:
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 0.5)))
        v.co += d * rough * (0.4 + v.co.z / max(height, 0.01))
        if grooves:   # 縦の溝（シロアリの塔のひだ）
            a = math.atan2(v.co.y, v.co.x)
            k = 1 + 0.10 * math.sin(a * grooves) ** 2
            v.co.x *= k
            v.co.y *= k
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts.add(bm, mat)


def player_nest():
    """自分の巣：土を盛った塚と、暗い入り口。入り口の奥に赤い目が光る。"""
    clay = C.toon_material("clay", "clay", light=(0.40, 0.78))
    dark = C.toon_material("nest_hole", "chitin", light=(2, 2), use_rim=False, spec=(2, 2))
    parts = C.Parts()
    _mound(parts, clay, 1.9, 0.55, "player_nest", rough=0.07, crater=0.0)
    parts.add(C.ellipsoid((0, 0, 0.50), (0.55, 0.42, 0.10), 18, 10), dark)        # 入り口の穴
    eye = C.glow_material("glow_eye_dim", "red", dim=True)
    for x, y in ((-0.22, 0.05), (-0.14, 0.05), (0.16, -0.08), (0.24, -0.08), (0.02, 0.18), (0.10, 0.18)):
        parts.add(C.ellipsoid((x, y, 0.58), (0.03, 0.03, 0.02), 8, 6), eye)
    rng = C.rng_for("crumbs")
    for _ in range(26):   # まわりの土くれ
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(1.0, 2.2)
        parts.add(C.ellipsoid((r * math.cos(a), r * math.sin(a), 0.04), (0.08, 0.07, 0.06), 8, 6), clay)
    return parts.to_mesh("player_nest")


def termite_mound(stage):
    """敵の巣：シロアリの塔（とがった塚）。4コマ = 無傷 / ひび / 上が崩れる / がれき。
    壊れるほど中の橙の光（シロアリの巣の奥）が見える。"""
    clay = C.toon_material("mound", "clay", light=(0.38, 0.74))
    hot = C.glow_material("glow_ember", "ember")
    parts = C.Parts()
    h = [5.0, 4.7, 3.0, 1.0][stage]
    _mound(parts, clay, 1.35, h, "mound_main", rough=0.08, grooves=7)
    if stage < 3:   # 小さな塔が寄り添う
        for side, hh, off in ((-1, 0.58, 1.15), (1, 0.44, 1.05)):
            p = C.Parts()
            _mound(p, clay, 0.50, h * hh, f"spire{side}", rough=0.05, grooves=5)
            me_bm = p.bm
            C.transform(me_bm, Matrix.Translation((side * off, 0.25, 0)))
            parts.add(me_bm, clay)
    # ひび割れ（光る）
    cracks = []
    if stage >= 1:
        cracks += [[(-0.3, -1.05, 0.6), (-0.15, -0.95, 1.1), (-0.28, -0.75, 1.6)],
                   [(0.35, -1.0, 0.4), (0.25, -0.9, 0.9)]]
    if stage >= 2:
        cracks += [[(0.0, -0.8, 1.2), (0.12, -0.6, 1.6), (0.0, -0.4, 2.0)],
                   [(-0.6, -0.8, 0.3), (-0.5, -0.7, 0.8)]]
    for c in cracks:
        parts.add(C.tube(c, [0.06] * len(c), 6), hot)
    if stage >= 2:   # 崩れた上から中の光
        parts.add(C.ellipsoid((0, -0.1, h - 0.05), (0.35, 0.3, 0.12), 12, 8), hot)
    if stage == 3:
        rng = C.rng_for("rubble")
        for _ in range(30):
            a, r = rng.uniform(0, 2 * math.pi), rng.uniform(0.6, 2.0)
            s = rng.uniform(0.08, 0.2)
            parts.add(C.ellipsoid((r * math.cos(a), r * math.sin(a), s * 0.5), (s, s * 0.8, s * 0.6), 8, 6), clay)
    return parts.to_mesh(f"termite_mound_{stage}")


# ---------------------------------------------------------------------------
# 石（行く手をふさぐ）・水たまり（入ったアリがおぼれる）
# ---------------------------------------------------------------------------
def rock(name, size):
    rng = C.rng_for(name)
    stone = C.toon_material("rock", "stone", light=(0.45, 0.80), spec=(0.93, 0.99))
    bm = C.ellipsoid((0, 0, size * 0.32), (size * rng.uniform(0.85, 1.05), size * rng.uniform(0.7, 0.9), size * 0.55),
                     20, 14)
    for v in bm.verts:
        n = Vector((math.sin(v.co.x * 7 + 1.3), math.cos(v.co.y * 6), math.sin(v.co.z * 5)))
        v.co += n * size * 0.05 + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.04
        if v.co.z < 0:
            v.co.z = 0.0
    parts = C.Parts()
    parts.add(bm, stone)
    # 根元のコケ
    moss = C.toon_material("grass", "grass")
    for _ in range(5):
        a = rng.uniform(0, 2 * math.pi)
        parts.add(C.ellipsoid((math.cos(a) * size * 0.85, math.sin(a) * size * 0.7, 0.03),
                              (size * 0.18, size * 0.12, 0.05), 8, 6), moss)
    return parts.to_mesh(name)


def puddle(name, rx, ry):
    """水たまり：まわりは湿った泥、水面は暗く、ところどころ光を返す筋。"""
    rng = C.rng_for(name)
    water = C.toon_material("water", "water", light=(0.62, 0.90), rim=2.0, spec=(2.0, 2.0))
    glint = C.toon_material("water_glint", "water", spec=(-2.0, 0.999))
    mud = C.toon_material("mud", "soil", light=(0.40, 0.78))
    parts = C.Parts()
    n = 40
    wob = [1 + 0.12 * math.sin(2 * math.pi * i / n * 3 + rng.random()) + 0.06 * math.sin(2 * math.pi * i / n * 5 + 1.7)
           for i in range(n)]
    for scale, z, mat in ((1.14, 0.010, mud), (1.0, 0.025, water)):
        bm = bmesh.new()
        c = bm.verts.new((0, 0, z))
        rim = [bm.verts.new((rx * scale * wob[i] * math.cos(2 * math.pi * i / n),
                             ry * scale * wob[i] * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
        for i in range(n):
            bm.faces.new((c, rim[i], rim[(i + 1) % n]))
        for f in bm.faces:
            f.smooth = False
        parts.add(bm, mat)
    for k in range(4):   # 光を返す筋（横長）
        y = ry * (0.5 - 0.3 * k) + rng.uniform(-0.05, 0.05)
        x = rng.uniform(-0.4, 0.4) * rx
        L = rx * rng.uniform(0.25, 0.45)
        parts.add(C.tube([(x - L / 2, y, 0.04), (x + L / 2, y + 0.03, 0.04)], [0.035, 0.03], 5), glint)
    return parts.to_mesh(name)
