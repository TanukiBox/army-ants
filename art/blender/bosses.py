"""ボス4体（オオカマキリ・ジョロウグモ・オオスズメバチ・女王バチ）の3Dモデルと動き。

このファイルは Blender の中で動きます（render_bosses.py から呼ばれます）。
長さの単位：ふつうのアリの体長がおよそ 1.0（ドット絵で 20 ドット）。地面が z=0。

組み立ては ant.py と同じく「頭が +Y（前）」で作り、最後に 180 度回して、
頭を -Y（カメラ側 = 画面の下 = プレイヤーの方）へ向けます。

  build(boss, anim, frame, layer) … 1コマ分のメッシュを返す
    layer="all"   … 全部（Blender の見本ファイル用）
    layer="body"  … はねを除いた体（メインのシート）
    layer="wings" … はねだけ（体は「抜き」の材質にして、体の後ろに回ったはねを隠す）
"""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix

import common as C

# 名前: マスの大きさ（ドット）、動き [(名前, コマ数, fps)]、はねを別のシートにするか
BOSSES = {
    "mantis": dict(cell=(176, 176), anims=[("idle", 6, 7), ("attack", 8, 12)], scale=1.12),
    "spider": dict(cell=(176, 176), anims=[("idle", 6, 6), ("attack", 8, 10)]),
    "hornet": dict(cell=(144, 144), anims=[("fly", 4, 18), ("dive", 6, 12)], wings=True),
    "queen":  dict(cell=(224, 224), anims=[("fly", 4, 16), ("attack", 8, 11)], wings=True),
    # 女王が呼び出す働きバチ（小さいので 8 倍で描く）
    "minion": dict(cell=(48, 48), anims=[("fly", 4, 18)], wings=True, ss=8),
}
SHOWCASE_ANIM = {"mantis": "attack", "spider": "attack", "hornet": "dive", "queen": "attack", "minion": "fly"}


# ---------------------------------------------------------------------------
# 小さな道具
# ---------------------------------------------------------------------------
def Rx(d):
    return Matrix.Rotation(math.radians(d), 4, "X")


def Ry(d):
    return Matrix.Rotation(math.radians(d), 4, "Y")


def Rz(d):
    return Matrix.Rotation(math.radians(d), 4, "Z")


def T(x, y=0.0, z=0.0):
    if isinstance(x, Vector):
        return Matrix.Translation(x)
    return Matrix.Translation((x, y, z))


def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def pw(u, us, rs):
    """us の点で rs の値をとる、なめらかな折れ線（形の輪郭を決める）。"""
    if u <= us[0]:
        return rs[0]
    for i in range(len(us) - 1):
        if us[i] <= u <= us[i + 1]:
            return lerp(rs[i], rs[i + 1], smooth((u - us[i]) / (us[i + 1] - us[i])))
    return rs[-1]


def side_v(v, side):
    """右側（x>0）用に書いた向きを、左右どちらかの側にする。"""
    return Vector((v[0] * side, v[1], v[2]))


def holdout_material():
    """「抜き」の材質：ここに隠れた物は透明になる（はねのシートで体の後ろを隠す）。"""
    m = bpy.data.materials.get("holdout")
    if m:
        return m
    m = bpy.data.materials.new("holdout")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    h = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(h.outputs[0], out.inputs["Surface"])
    return m


class Kit:
    """部品をまとめる入れ物。layer に合わせて、はねを入れる／抜く。"""

    def __init__(self, layer):
        self.layer = layer
        self.parts = C.Parts()

    @staticmethod
    def toon(name, ramp, **kw):
        return C.toon_material(name, ramp, **kw)

    @staticmethod
    def glow(name, glow, **kw):
        return C.glow_material(name, glow, **kw)

    def add(self, bm, mat, fn=None, xf=None, wing=False):
        """bm（部品の形）を、fn で面ごとの材質を決めてから xf で動かして加える。
        fn(ring, face) は「動かす前」の形で呼ばれる（模様の位置を部品の中の座標で決められる）。
        xf は Matrix か、bm を受け取る関数か、それらのリスト（前から順に効く）。"""
        if wing and self.layer == "body":
            bm.free()
            return
        if self.layer == "wings" and not wing:
            mat, fn = holdout_material(), None
        lookup = None
        if fn is not None:
            bm.faces.index_update()
            lay = bm.faces.layers.int.get("ring")
            choice = [fn(f[lay] if lay is not None else -1, f) for f in bm.faces]
            lookup = (lambda ring, f: choice[f.index])
        if xf is not None:
            for x in (xf if isinstance(xf, (list, tuple)) else [xf]):
                if isinstance(x, Matrix):
                    bmesh.ops.transform(bm, matrix=x, verts=bm.verts)
                else:
                    x(bm)
        self.parts.add(bm, mat, lookup)

    def finish(self, name, scale=1.0):
        me = self.parts.to_mesh(name)
        me.transform(Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Diagonal((scale, scale, scale, 1.0)))
        return me   # ↑ 頭をカメラ側（-Y）へ向け、ボスごとの大きさにする


def blob(radii, segs=20, rings=12):
    """原点の楕円体（長い軸が +Y）。"""
    return C.ellipsoid((0, 0, 0), radii, segs, rings)


def lathe(samples, segs=20):
    """-Y 方向へ伸びる「ろくろ」の形。samples: [(s, rx, rz, z0)]（s だけ後ろの断面）。
    両端は rx=0 で閉じる。腹など、形を細かく決めたい部分に使う。"""
    bm = bmesh.new()
    rows = []
    for s, rx, rz, z0 in samples:
        if rx <= 1e-5:
            rows.append([bm.verts.new((0.0, -s, z0))])
        else:
            rows.append([bm.verts.new((rx * math.cos(2 * math.pi * j / segs), -s,
                                       z0 + rz * math.sin(2 * math.pi * j / segs)))
                         for j in range(segs)])
    for a, b in zip(rows, rows[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(segs):
            k = (j + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[k], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[j], a[k], b[0]))
            else:
                bm.faces.new((a[j], a[k], b[k], b[j]))
    for f in bm.faces:
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def profile_samples(fn, length, n=28):
    """fn(u)（u=0〜1）→ (rx, rz, z0) を、両端を細かく n 点で取る。"""
    out = []
    for i in range(n + 1):
        u = (1 - math.cos(math.pi * i / n)) / 2
        rx, rz, z0 = fn(u)
        if i in (0, n):
            rx = rz = 0.0
        out.append((u * length, rx, rz, z0))
    return out


def bend(k, s0=0.0):
    """-Y へ伸びた部品を、s0 より後ろで曲げる（k>0 で下へ巻き込む、k<0 で上へ反る）。
    k は曲がりの強さ（1/半径）。腹を丸める・反らすのに使う。"""
    def f(bm):
        if abs(k) < 1e-6:
            return
        R = 1.0 / k
        for v in bm.verts:
            x, y, z = v.co
            s = -y
            if s <= s0:
                continue
            th = (s - s0) * k
            rr = R + z
            v.co = Vector((x, -s0 - rr * math.sin(th), -R + rr * math.cos(th)))
    return f


def resample(points, radii, step):
    pts = [Vector(p) for p in points]
    out_p, out_r, out_s = [pts[0]], [radii[0]], [0.0]
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = (b - a).length
        n = max(1, int(math.ceil(L / step)))
        for k in range(1, n + 1):
            t = k / n
            out_p.append(a.lerp(b, t))
            out_r.append(lerp(radii[i], radii[i + 1], t))
            out_s.append(acc + L * t)
        acc += L
    return out_p, out_r, out_s


def ptube(points, radii, segs=8, step=0.1):
    """C.tube と同じ管。面ごとに「付け根からの長さ」を返す関数も一緒に返す（縞模様用）。"""
    pts, rs, ss = resample(points, radii, step)
    bm = C.tube(pts, rs, segs)
    npair = len(pts) - 1

    def arc(f):
        i = f.index // segs
        return (ss[i] + ss[i + 1]) * 0.5 if i < npair else -1.0
    return bm, arc


def ik2(hip, foot, a, b, bend_dir):
    """2本の骨（長さ a, b）で hip から foot へ届かせる。ひざは bend_dir の側へ曲がる。
    戻り値：(ひざ, 先)。届かないときは foot の方向へまっすぐ伸ばす。"""
    hip, foot = Vector(hip), Vector(foot)
    d = foot - hip
    L = d.length
    dn = d.normalized()
    L = min(max(L, abs(a - b) + 1e-3), a + b - 1e-3)
    x = (a * a - b * b + L * L) / (2 * L)
    h = math.sqrt(max(a * a - x * x, 0.0))
    bd = Vector(bend_dir)
    bd = bd - dn * bd.dot(dn)
    if bd.length < 1e-4:
        bd = Vector((0, 0, 1)) - dn * dn.z
    bd.normalize()
    return hip + dn * x + bd * h, hip + dn * L


def perp(v, axis, fallback):
    """v の、axis に直角な成分（短すぎるときは fallback）。"""
    p = v - axis * v.dot(axis)
    if p.length < 0.25:
        p = fallback - axis * fallback.dot(axis)
    return p.normalized()


# ===========================================================================
# オオカマキリ（mantis）
# ===========================================================================
MANTIS_LEN = dict(coxa=0.92, femur=1.75, tibia=1.30)
MANTIS_PB, MANTIS_PF = V(0, 0.42, 1.05), V(0, 1.80, 2.05)   # 前胸の付け根と先

# 攻撃：鎌を高く振り上げる → 前へ振り下ろす → 内へ刈り取る → 戻る
# (lean, lunge, bob, head, coxa, femur, tibia, abd, wing)   向きは右側の鎌（ワールド）
MANTIS_ATTACK = [
    (-8, -0.10, 0.05, 4, (0.60, 0.50, -0.50), (0.62, -0.25, 0.75), (0.20, 0.05, 0.98), -10, 0.6),
    (-14, -0.16, 0.10, -2, (0.62, 0.40, -0.40), (0.78, -0.25, 0.58), (0.62, -0.05, 0.78), -13, 0.8),
    (6, 0.10, 0.03, 16, (0.50, 0.62, -0.42), (0.62, 0.60, 0.48), (0.30, 0.90, -0.30), -9, 0.7),
    (20, 0.14, -0.10, 26, (0.42, 0.68, -0.60), (0.55, 0.55, -0.63), (0.10, 0.12, -0.99), -6, 0.3),
    (18, 0.12, -0.08, 24, (0.38, 0.70, -0.60), (0.35, 0.62, -0.70), (-0.85, 0.05, -0.52), -6, 0.2),
    (12, 0.10, -0.04, 20, (0.38, 0.70, -0.60), (0.25, 0.72, -0.64), (-0.95, -0.22, -0.22), -7, 0.1),
    (4, 0.06, 0.0, 15, (0.55, 0.62, -0.55), (0.62, 0.0, 0.78), (-0.40, -0.10, -0.91), -7, 0.1),
    (1, 0.02, 0.0, 13, (0.62, 0.62, -0.48), (0.58, -0.16, 0.80), (-0.30, 0.28, -0.92), -6, 0.25),
]
MANTIS_TRAIL = {2: 0.8, 3: 1.0, 4: 0.75}   # 鎌の軌跡を描くコマ（強さ）


def _mantis_pose(anim, f):
    """1コマ分の姿勢。鎌（前脚）の向きは右側の「基節・腿節・脛節」の向き（ワールド）。"""
    if anim == "idle":
        ph = 2 * math.pi * f / 6
        s = math.sin(ph)
        return dict(
            lean=2.0 * s, lunge=0.0, bob=0.025 * math.sin(2 * ph), sway=0.11 * s, yaw=3.5 * s,
            head=12.0 + 4.0 * math.sin(ph + 0.8),
            coxa=(0.62, 0.62, -0.48),
            femur=(0.72, -0.10, 0.68 + 0.10 * math.sin(ph + 1.0)),
            tibia=(-0.25, 0.32 + 0.06 * s, -0.91),
            curl=-0.14, abd=-6.0 + 1.5 * math.sin(ph + 2.0), ant=10.0 * s, wing=0.25)
    lean, lunge, bob, head, cx, fe, ti, abd, wing = MANTIS_ATTACK[f]
    return dict(lean=lean, lunge=lunge, bob=bob, sway=0.0, yaw=0.0, head=head, coxa=cx, femur=fe,
                tibia=ti, curl=-0.14 - 0.08 * wing, abd=abd, ant=0.0, wing=wing)


def _mantis_upper(P):
    """上半身（前胸・頭・鎌）を動かす行列。lean で前へ倒れ、sway で左右にゆれる。"""
    Pb = MANTIS_PB
    return T(P["sway"], P["lunge"], P["bob"]) @ T(Pb) @ Rz(P["yaw"]) @ Rx(-P["lean"]) @ T(-Pb)


def _raptor_points(P, side):
    """鎌の関節の位置：肩 S、基節の先 Cx、ひざ K、脛節の先 Tt と、内側の向き。"""
    Lc, Lf, Lt = MANTIS_LEN["coxa"], MANTIS_LEN["femur"], MANTIS_LEN["tibia"]
    axis = MANTIS_PF - MANTIS_PB
    S = _mantis_upper(P) @ (MANTIS_PB + axis * 0.74 + V(side * 0.17, 0.02, -0.10))
    cd = side_v(P["coxa"], side).normalized()
    fd = side_v(P["femur"], side).normalized()
    td = side_v(P["tibia"], side).normalized()
    Cx = S + cd * Lc
    K = Cx + fd * Lf
    Tt = K + td * Lt
    inn = perp(td, fd, V(-side * 0.6, 0.2, -0.8))          # 腿節の内側（脛節が折りたたまれる側）
    inn_t = perp(-fd, td, V(-side * 0.6, 0.2, 0.8))        # 脛節の内側（腿節の側）
    return S, Cx, K, Tt, fd, td, inn, inn_t


def _blade(K, td, inn_t, Lt):
    """脛節：内側へ反った鎌の刃（点の列と太さ）。先は鋭い鉤爪。"""
    pts, rad = [], []
    n = 7
    for i in range(n):
        t = i / (n - 1)
        pts.append(K + td * (Lt * t) + inn_t * (0.16 * math.sin(math.pi * t * 0.9) + 0.26 * t ** 3))
        rad.append(lerp(0.11, 0.035, t ** 1.4))
    return pts, rad


def mantis(kit, anim, f):
    body = kit.toon("t_mantis", "mantis")
    teg = kit.toon("t_mantis_teg", "mantis", light=(0.50, 0.86), spec=(0.93, 0.985))
    eye = kit.glow("g_green", "green")
    gdim = kit.glow("g_green_dim", "green", dim=True)
    dark = kit.toon("t_mantis_dark", "mantis", light=(0.75, 0.95), use_rim=False, spec=(0.99, 0.999))
    P = _mantis_pose(anim, f)
    base = T(0, P["lunge"], P["bob"])

    # --- 胸（中胸・後胸）--------------------------------------------------------
    kit.add(blob((0.36, 0.66, 0.31), 24, 12), body, xf=base @ T(0, -0.02, 0.98))

    # --- 腹と前ばね（後ろへのび、少し反り上がる）---------------------------------
    L_abd = 2.50

    def abd_prof(u):
        r = pw(u, (0, 0.06, 0.25, 0.48, 0.70, 0.88, 1.0), (0.20, 0.30, 0.52, 0.62, 0.55, 0.36, 0.12))
        return r, r * 0.72, 0.0

    abd_xf = [bend(P["curl"], 0.8), base @ T(0, -0.55, 1.00) @ Rx(P["abd"])]

    def seam_fn(ring, fc):   # 腹の節の境目（暗い線）
        y = -fc.calc_center_median().y
        return dark if any(abs(y - s) < 0.05 for s in (0.60, 0.97, 1.34, 1.71, 2.08)) else None
    kit.add(lathe(profile_samples(abd_prof, L_abd, 36), 26), body, seam_fn, abd_xf)
    w = P["wing"]
    for side in (-1, 1):
        rx = 0.36

        def teg_fn(ring, fc, side=side, rx=rx):   # 前ばねの外のふちに光る緑の筋
            c = fc.calc_center_median()
            if c.z <= 0.0:
                return None
            if c.x * side > 0.68 * rx and -0.9 < c.y < 1.05:
                return gdim
            return None
        # 攻撃の前は、はねを少し持ち上げて広げる（威嚇）
        kit.add(blob((rx, 1.18, 0.06), 20, 16), teg, teg_fn,
                [Ry(side * (14 + 10 * w)) @ Rz(-side * (4 + 10 * w)), T(side * (0.20 + 0.10 * w), -1.25, 0.42 + 0.08 * w),
                 Rx(-8 * w)] + abd_xf)

    # --- 前胸（長い首）・頭（上半身は lean で前へ倒れる）---------------------------
    up = base @ _mantis_upper(dict(P, lunge=0.0, bob=0.0))
    Pb, Pf = MANTIS_PB, MANTIS_PF
    axis = Pf - Pb
    pts = [Pb + axis * t for t in (0.0, 0.18, 0.42, 0.62, 0.78, 0.92, 1.0)]
    kit.add(C.tube(pts, [0.26, 0.19, 0.16, 0.19, 0.27, 0.22, 0.15], 14), body, xf=up)
    kit.add(C.tube([Pb + axis * 0.10 + V(0, 0, 0.17), Pb + axis * 0.70 + V(0, 0, 0.15)], [0.06, 0.05], 6),
            dark, xf=up)

    head = up @ T(Pf + V(0, 0.10, 0.06)) @ Rx(-P["head"])
    kit.add(blob((0.40, 0.25, 0.32), 22, 12), body, xf=head @ T(0, 0.12, 0.10))
    kit.add(blob((0.24, 0.16, 0.22), 18, 10), body, xf=head @ T(0, 0.26, -0.17))
    kit.add(blob((0.15, 0.12, 0.15), 14, 8), dark, xf=head @ T(0, 0.32, -0.42))
    for side in (-1, 1):
        kit.add(blob((0.20, 0.21, 0.27), 16, 10), eye, xf=head @ T(side * 0.44, 0.12, 0.22) @ Ry(side * 28))
        sw = math.radians(P["ant"]) * side
        b0 = V(side * 0.10, 0.33, 0.30)
        p1 = b0 + V(side * 0.20, 0.25, 0.45)
        p2 = p1 + V(side * (0.32 + 0.1 * sw), -0.10, 0.55)
        p3 = p2 + V(side * (0.45 + 0.2 * sw), -0.60, 0.30)
        kit.add(C.tube([b0, p1, p2, p3], [0.050, 0.046, 0.043, 0.040], 6), body, xf=head)
    for p in (V(0, 0.34, 0.28), V(-0.10, 0.29, 0.36), V(0.10, 0.29, 0.36)):   # 単眼
        kit.add(blob((0.05, 0.05, 0.05), 8, 6), eye, xf=head @ T(p))

    # --- 鎌（前脚）--------------------------------------------------------------------
    for side in (-1, 1):
        _raptor(kit, P, side, body, eye)

    # --- 中脚・後脚（足先は地面に固定。体が動くと、ひざで調整）-----------------
    for side in (-1, 1):
        for hy, foot, a, b in ((0.30, (1.85, 1.30), 1.30, 1.45), (-0.34, (2.10, -1.55), 1.55, 1.70)):
            hip = base @ V(side * 0.26, hy, 0.88)
            F = V(side * foot[0], foot[1], 0.05)
            out = Vector((F.x - hip.x, F.y - hip.y, 0)).normalized()
            K, F2 = ik2(hip, F, a, b, out * 0.35 + V(0, 0, 1))
            tars = F2 + out * 0.42 + V(0, 0, -0.03)
            kit.add(C.tube([hip, K, F2, tars], [0.11, 0.085, 0.062, 0.048], 9), body)

    # --- 鎌の軌跡（振り下ろし・刈り取りのコマだけ、ほのかに光る）-----------------
    if anim == "attack" and f in MANTIS_TRAIL:
        _trail(kit, f, MANTIS_TRAIL[f], gdim)
    return kit


def _raptor(kit, P, side, body, glow):
    S, Cx, K, Tt, fd, td, inn, inn_t = _raptor_points(P, side)
    Lf, Lt = MANTIS_LEN["femur"], MANTIS_LEN["tibia"]
    kit.add(C.tube([S, S.lerp(Cx, 0.5), Cx], [0.17, 0.15, 0.12], 10), body)
    # 腿節：根元が太く平たい
    kit.add(C.tube([Cx, Cx + fd * (Lf * 0.20), Cx + fd * (Lf * 0.50), K - fd * 0.06, K],
                   [0.12, 0.21, 0.18, 0.12, 0.10], 12), body)
    for t in (0.26, 0.38, 0.50, 0.62, 0.74, 0.86):         # 腿節の棘（光る緑）
        p = Cx + fd * (Lf * t) + inn * 0.12
        L = 0.22 if t in (0.38, 0.62) else 0.15
        kit.add(C.tube([p, p + inn * L - fd * 0.06], [0.055, 0.0], 6), glow)
    pts, rad = _blade(K, td, inn_t, Lt)                      # 脛節（鎌の刃）
    kit.add(C.tube(pts, rad, 10), body)
    for i in (1, 2, 3, 4):                                   # 刃の内側の棘
        p = pts[i] + inn_t * rad[i] * 0.8
        kit.add(C.tube([p, p + inn_t * 0.12 + td * 0.03], [0.045, 0.0], 6), glow)
    tip = pts[-1]
    hook = tip + td * 0.10 + inn_t * 0.20                    # 先の鉤爪
    kit.add(C.tube([pts[-2], tip, hook], [0.06, 0.045, 0.0], 8), glow)


def _lerp_pose(P0, P1, t):
    out = dict(P1)
    for k in ("lean", "lunge", "bob", "sway", "yaw"):
        out[k] = lerp(P0[k], P1[k], t)
    for k in ("coxa", "femur", "tibia"):
        a, b = Vector(P0[k]).normalized(), Vector(P1[k]).normalized()
        out[k] = tuple(a.lerp(b, t).normalized())
    return out


def _trail(kit, f, strength, mat):
    """鎌の先が通った道すじ（前のコマ → このコマ）を、先ほど太い光る弧にする。"""
    P0, P1 = _mantis_pose("attack", f - 1), _mantis_pose("attack", f)
    for side in (-1, 1):
        pts, rad = [], []
        n = 10
        for i in range(n):
            t = i / (n - 1)
            S, Cx, K, Tt, fd, td, inn, inn_t = _raptor_points(_lerp_pose(P0, P1, t), side)
            bl, _ = _blade(K, td, inn_t, MANTIS_LEN["tibia"])
            pts.append(bl[-2].lerp(bl[-1], 0.5))
            rad.append(0.02 + 0.075 * strength * smooth(t) * (1 - 0.6 * smooth((t - 0.85) / 0.15)))
        rad[0] = 0.0
        kit.add(C.tube(pts, rad, 6), mat)


# ===========================================================================
# ジョロウグモ（spider）
# ===========================================================================
# 脚：(付け根の角度[度]、足先までの距離、腿の長さ、すねの長さ)。1番前が最も長く、3番目が短い
SPIDER_LEGS = [(64.0, 4.05, 2.10, 2.30), (33.0, 3.70, 1.90, 2.15), (-10.0, 2.35, 1.20, 1.35),
               (-44.0, 3.65, 1.85, 2.15)]
SP_PIVOT = V(0, -0.55, 0.55)


def _web(center, size, tilt):
    """円い網（8本の縦糸＋3重の横糸）の点を返す。tilt=0 で立てた網、90 で地面に寝た網。"""
    e1 = V(1, 0, 0)
    t = math.radians(tilt)
    e2 = V(0, math.sin(t), math.cos(t))
    spokes = []
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        spokes.append(Vector(center) + (e1 * math.cos(a) + e2 * math.sin(a)) * size)
    return spokes, e1, e2


def _spider_pose(anim, f):
    P = dict(by=0.0, bz=0.0, pitch=0.0, abd=0.0, palp=0.0, feet={}, web=None, line=False, fang=0.0)
    if anim == "idle":
        ph = 2 * math.pi * f / 6
        s = math.sin(ph)
        P.update(bz=0.035 * s, pitch=1.5 * math.sin(ph + 0.5), abd=2.5 * math.sin(ph + 1.2),
                 palp=s)
        # 前脚を1本ずつ持ち上げて探る・2番目の脚も少し動く
        P["feet"] = {(0, -1): dict(lift=0.45 * max(0.0, s), reach=-0.25 * max(0.0, s), yaw=4 * max(0.0, s)),
                     (0, 1): dict(lift=0.45 * max(0.0, -s), reach=-0.25 * max(0.0, -s), yaw=4 * max(0.0, -s)),
                     (1, -1): dict(yaw=3.0 * math.sin(ph + 2.0)),
                     (1, 1): dict(yaw=3.0 * math.sin(ph + 5.0)),
                     (3, -1): dict(yaw=1.5 * math.sin(ph + 1.0)),
                     (3, 1): dict(yaw=1.5 * math.sin(ph + 4.0))}
        return P
    # 攻撃：身をかがめる → 前脚で網を掲げて立ち上がる → 前へ投げる → 網が地面に広がる
    keys = [
        # by    bz    pitch abd  web(center, size, tilt) or None                 line  fang
        (-0.05, -0.12, -5, 4, None, False, 0.3),
        (-0.10, 0.10, 20, -10, ((0, 2.35, 2.05), 0.80, -40), False, 0.6),
        (-0.15, 0.18, 28, -16, ((0, 2.45, 2.35), 0.95, -48), False, 1.0),
        (0.30, 0.04, 6, -4, ((0, 3.30, 1.55), 1.15, -30), True, 1.0),
        (0.20, -0.05, -3, 2, ((0, 3.85, 0.70), 1.40, 68), True, 0.8),
        (0.10, -0.03, -2, 2, ((0, 4.00, 0.06), 1.60, 90), True, 0.5),
        (0.05, 0.0, 0, 1, ((0, 4.00, 0.04), 1.62, 90), False, 0.3),
        (0.0, 0.0, 0, 0, None, False, 0.0),
    ]
    by, bz, pitch, abd, web, line, fang = keys[f]
    P.update(by=by, bz=bz, pitch=pitch, abd=abd, web=web, line=line, fang=fang, frame=f)
    feet = {}
    if f == 0:
        for s in (-1, 1):
            feet[(0, s)] = dict(reach=-0.55)
            feet[(1, s)] = dict(reach=-0.25)
    elif web is not None and f <= 3:
        spokes, e1, e2 = _web(*web)
        for s in (-1, 1):
            # 網の4すみを前脚2対で持つ（右=+x）
            up_corner = spokes[0] if s > 0 else spokes[3]
            lo_corner = spokes[7] if s > 0 else spokes[4]
            feet[(0, s)] = dict(at=up_corner, bend=V(s * 1.0, 0.2, 0.45))
            feet[(1, s)] = dict(at=lo_corner, bend=V(s * 1.0, 0.0, 0.6))
    elif f == 4:
        for s in (-1, 1):
            feet[(0, s)] = dict(reach=0.35, lift=0.5)
            feet[(1, s)] = dict(reach=0.2, lift=0.2)
    elif f == 5:
        for s in (-1, 1):
            feet[(0, s)] = dict(reach=0.25)
    P["feet"] = feet
    return P


def spider(kit, anim, f):
    shell = kit.toon("t_chitin", "chitin")
    abdm = kit.toon("t_stone", "stone")
    band = kit.toon("t_amber", "amber")
    yel = kit.glow("g_yellow", "yellow")
    red = kit.glow("g_red", "red")
    reddim = kit.glow("g_red_dim", "red", dim=True)
    silk = kit.glow("g_yellow_dim", "yellow", dim=True)
    P = _spider_pose(anim, f)
    Mb = T(0, P["by"], P["bz"]) @ T(SP_PIVOT) @ Rx(P["pitch"]) @ T(-SP_PIVOT)

    # --- 頭胸部 -------------------------------------------------------------------
    kit.add(blob((0.52, 0.62, 0.26), 26, 14), shell, xf=Mb @ T(0, 0.0, 0.60))
    kit.add(blob((0.31, 0.30, 0.20), 20, 12), shell, xf=Mb @ T(0, 0.30, 0.74))
    # 目（8つ。真ん中の4つが大きい）
    for x, y, z, r in ((0.085, 0.58, 0.86, 0.088), (0.095, 0.44, 0.95, 0.078),
                       (0.23, 0.52, 0.81, 0.058), (0.25, 0.41, 0.86, 0.054)):
        for side in (-1, 1):
            kit.add(blob((r, r, r), 10, 6), red, xf=Mb @ T(side * x, y, z))
    # 鋏角と牙
    for side in (-1, 1):
        kit.add(blob((0.12, 0.13, 0.20), 14, 10), shell, xf=Mb @ T(side * 0.12, 0.60, 0.44) @ Rx(-20))
        fo = P["fang"]
        a = V(side * 0.12, 0.66, 0.28)
        kit.add(C.tube([a, a + V(-side * (0.05 + 0.05 * fo), 0.08 + 0.06 * fo, -0.12)], [0.045, 0.0], 6),
                reddim, xf=Mb)
        # 触肢（短い脚のようなもの）
        pa = P["palp"] * side
        p0 = V(side * 0.22, 0.50, 0.44)
        p1 = p0 + V(side * 0.18, 0.30 + 0.05 * pa, 0.05)
        p2 = p1 + V(side * 0.02, 0.32, -0.20 + 0.06 * pa)
        kit.add(C.tube([p0, p1, p2], [0.060, 0.055, 0.050], 7), shell, xf=Mb)

    # --- 腹（細長い円柱。黄色く光る縞、後ろの先と下側が赤く光る）---------------
    La = 2.55

    def abd_prof(u):
        r = (1 - abs(2 * u - 1) ** 2.6) ** (1 / 2.6)
        rx = 0.66 * r * (0.86 + 0.14 * u)
        return rx, rx * 0.84, 0.0
    bands = (0.20, 0.40, 0.60, 0.78)

    def abd_fn(ring, fc):
        c = fc.calc_center_median()
        u = -c.y / La
        rx, rz, _ = abd_prof(min(max(u, 0.0), 1.0))
        xn = c.x / max(rx, 1e-3)
        zn = c.z / max(rz, 1e-3)
        ax = abs(xn)
        if u > 0.91 and zn > -0.7:
            return red                                   # 腹の先（糸いぼのまわり）が赤く光る
        if zn < -0.40 and u > 0.30:
            return reddim                                # 下側の赤（ふちからのぞく）
        if -0.40 < zn < 0.10 and any(abs(u - b) < 0.030 for b in (0.30, 0.48, 0.66, 0.82)):
            return red                                   # 横腹の赤い点
        if zn > -0.30:
            ue = u - 0.09 * ax + 0.035 * math.sin(math.pi * ax * 2.0)   # W 形の細い線
            for b in bands:
                if abs(ue - b) < 0.020:
                    return yel
            if abs(ax - 0.60) < 0.055 and 0.10 < u < 0.84:
                return yel                               # 背中の両わきの縦線
        return None
    abd_xf = Mb @ T(0, -0.55, 0.66) @ Rx(-8 + P["abd"]) @ T(0, 0, 0.28)
    kit.add(lathe(profile_samples(abd_prof, La, 40), 28), abdm, abd_fn, abd_xf)
    kit.add(C.tube([V(0, -0.45, 0.58), V(0, -0.70, 0.75)], [0.12, 0.12], 8), shell, xf=Mb)

    # --- 脚 -----------------------------------------------------------------------------
    for i, (yaw, reach, a, b) in enumerate(SPIDER_LEGS):
        for side in (-1, 1):
            o = P["feet"].get((i, side), {})
            ya = math.radians(yaw + o.get("yaw", 0.0))
            hip = Mb @ V(side * 0.42 * math.cos(ya), 0.50 * math.sin(ya), 0.52)
            if "at" in o:
                foot = Vector(o["at"])
            else:
                R = reach + o.get("reach", 0.0)
                foot = V(side * R * math.cos(ya), R * math.sin(ya), o.get("lift", 0.0))
            out = Vector((foot.x - hip.x, foot.y - hip.y, 0))
            out = out.normalized() if out.length > 1e-4 else V(side, 0, 0)
            ankle = foot - out * 0.30 + V(0, 0, 0.30)
            if "at" in o:   # 網を持つ脚：先はそのまま網のすみへ、ひざは外へ張り出す
                ankle = foot
            K, A2 = ik2(hip, ankle, a, b, o.get("bend", V(0, 0, 1) + out * 0.25))
            pts = [hip, K, A2, foot] if "at" not in o else [hip, K, A2]
            bm, arc = ptube(pts, [0.10, 0.085, 0.062, 0.046][:len(pts)], 8, 0.09)
            bands_at = ((a + b * 0.30, a + b * 0.40),)
            dark_at = ((0.0, a * 0.25), (a * 0.55, a * 0.68), (a - 0.10, a + 0.08))

            def leg_fn(ring, fc, arc=arc, bands_at=bands_at, dark_at=dark_at):
                s = arc(fc)
                if any(lo <= s <= hi for lo, hi in bands_at):
                    return silk                              # 脚の縞（ほのかに光る黄色）
                if any(lo <= s <= hi for lo, hi in dark_at):
                    return band                              # 付け根とひざ（黄土色）
                return None
            kit.add(bm, shell, leg_fn)

    # --- 網と糸 -----------------------------------------------------------------------
    if P["web"] is not None:
        frame = P.get("frame", 0)
        spokes, e1, e2 = _web(*P["web"])
        c = Vector(P["web"][0])
        rr = 0.040 if frame != 6 else 0.034
        for sp in spokes:
            kit.add(C.tube([c, sp], [rr, rr], 5), silk)
        if frame != 6:
            for frac in (0.38, 0.70, 1.0):
                ring = [c + (sp - c) * frac for sp in spokes]
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    kit.add(C.tube([p, q], [rr * 0.95, rr * 0.95], 5), silk)
        if P["line"]:
            mouth = Mb @ V(0, 0.75, 0.30)
            kit.add(C.tube([mouth, mouth.lerp(c, 0.5) + V(0, 0, 0.15), c], [0.035, 0.035, 0.035], 5), silk)
    return kit


# ===========================================================================
# オオスズメバチ（hornet）と女王バチ（queen）
# ===========================================================================
HORNET = dict(scale=1.0, H=1.40, gaster=2.05, sting=0.32, eye="ember", band="yellow", gast_ramp="chitin",
              ornate=False, fore=(2.35, 0.64), hind=(1.60, 0.46), thick=1.0)
# 働きバチ：形はオオスズメバチと同じで小さい。細い部分（脚・触角・はねの筋）は太めにして潰れないようにする
MINION = dict(HORNET, scale=0.40, H=0.55, thick=1.12, band="ember", limb=0.62, antenna=False)
QUEEN = dict(scale=1.72, H=1.60, gaster=2.40, sting=0.52, eye="red", band="yellow", gast_ramp="crimson",
             ornate=True, fore=(2.40, 0.66), hind=(1.62, 0.47), thick=1.0)

GASTER_SEGS = (0.0, 0.15, 0.34, 0.52, 0.69, 0.84, 1.0)


def _wasp_pose(anim, f, Q):
    P = dict(by=0.0, bz=0.0, pitch=0.0, head=0.0, curl=0.10, gp=-8.0, ext=0.0, mand=0.25,
             fphi=0.0, fpsi=0.0, hphi=0.0, hpsi=0.0, legs="hang", ant=0.0)
    if anim == "fly":
        fphi = (60, 16, -34, 14)[f]
        fpsi = (10, 4, -10, -3)[f]
        hphi = (40, 30, -22, -6)[f]
        hpsi = (6, 4, -8, -4)[f]
        P.update(fphi=fphi, fpsi=fpsi, hphi=hphi, hpsi=hpsi, bz=(0.05, 0.0, -0.05, 0.0)[f],
                 curl=(0.08, 0.11, 0.14, 0.11)[f], gp=(-8, -9, -10, -9)[f], mand=(0.50, 0.60, 0.50, 0.42)[f],
                 pitch=(2, 0, -2, 0)[f], ant=(1, 0, -1, 0)[f])
        return P
    if anim == "dive":
        # 急降下：はねを後ろへたたみ、頭を下げて突っ込み、腹を前へ巻いて針を突き出す
        keys = [
            # by    bz    pitch head curl gp   ext  mand fphi fpsi  hphi hpsi legs
            (-0.10, 0.25, 12, -6, 0.15, -6, 0.0, 0.6, 62, 6, 45, 4, "hang"),
            (0.05, 0.10, -14, 4, 0.40, -12, 0.0, 0.9, 30, -30, 22, -26, "reach"),
            (0.30, -0.25, -30, 10, 0.75, -18, 0.10, 1.0, 12, -62, 8, -58, "reach"),
            (0.45, -0.45, -34, 12, 1.05, -22, 0.25, 1.0, 6, -70, 4, -66, "strike"),
            (0.40, -0.40, -24, 8, 1.15, -24, 0.30, 0.3, 26, -40, 18, -36, "strike"),
            (0.15, -0.05, -6, 2, 0.45, -12, 0.05, 0.4, 50, -8, 36, -6, "hang"),
        ]
    else:   # queen attack：立ち上がって浮き上がり、腹を前下へ振って大きな針を突き出す
        keys = [
            (-0.05, 0.15, 8, -4, 0.15, -8, 0.0, 0.5, 62, 8, 44, 6, "hang"),
            (-0.15, 0.55, 26, -12, 0.35, 0, 0.0, 0.9, 40, 16, 30, 12, "strike"),
            (-0.20, 0.90, 34, -16, 0.55, 16, 0.10, 1.0, -8, -6, -5, -5, "strike"),
            (0.15, 1.20, 18, -8, 0.75, 30, 1.10, 1.0, 26, -30, 18, -26, "spread"),
            (0.30, 1.30, 15, -4, 0.80, 35, 1.60, 0.8, 4, -44, 2, -40, "spread"),
            (0.28, 1.25, 15, -4, 0.80, 33, 1.45, 0.4, 44, -18, 32, -14, "spread"),
            (0.12, 0.65, 12, -2, 0.45, 8, 0.40, 0.3, 58, 2, 42, 2, "hang"),
            (0.0, 0.20, 5, 0, 0.20, -6, 0.0, 0.3, 20, 4, 14, 2, "hang"),
        ]
    by, bz, pitch, head, curl, gp, ext, mand, fphi, fpsi, hphi, hpsi, legs = keys[f]
    P.update(by=by, bz=bz, pitch=pitch, head=head, curl=curl, gp=gp, ext=ext, mand=mand,
             fphi=fphi, fpsi=fpsi, hphi=hphi, hpsi=hpsi, legs=legs)
    return P


def wasp(kit, anim, f, Q):
    sc = Q["scale"]
    headm = kit.toon("t_amber", "amber")
    thor = kit.toon("t_wasp_thor", "amber", light=(0.62, 0.92), spec=(0.94, 0.985))   # 暗い茶色
    gas = kit.toon("t_wasp_" + Q["gast_ramp"], Q["gast_ramp"], rim=0.70, spec=(0.95, 0.99))
    dark = kit.toon("t_wasp_dark", "chitin", rim=0.75, spec=(0.97, 0.995))
    legm = kit.toon("t_amber", "amber")
    th = Q["thick"]
    eye = kit.glow("g_" + Q["eye"], Q["eye"])
    band = kit.glow("g_" + Q["band"], Q["band"])
    ember = kit.glow("g_ember", "ember")
    wingm = kit.toon("t_wing", "silk", light=(0.30, 0.70))
    vein = kit.toon("t_vein", "chitin", use_rim=False, spec=(0.99, 0.999))
    P = _wasp_pose(anim, f, Q)
    orn = Q["ornate"]

    # 体の向き（胸の真ん中が回転の中心）
    Mb = T(0, P["by"] * sc, Q["H"] + P["bz"] * sc) @ Rx(P["pitch"]) @ Matrix.Diagonal((sc, sc, sc, 1.0))

    # --- 胸 --------------------------------------------------------------------------
    def thor_fn(ring, fc):
        if not orn:
            return None
        c = fc.calc_center_median()
        if c.z > 0.22 and (abs(abs(c.x) - 0.17) < 0.035 and -0.30 < c.y < 0.40):
            return ember                                  # 女王：背中の2本の光る線
        if c.z > 0.30 and abs(c.x) < 0.035 and c.y > -0.35:
            return ember
        return None
    kit.add(blob((0.47, 0.60, 0.45), 24, 14), thor, thor_fn, Mb)
    kit.add(blob((0.30, 0.19, 0.16), 14, 8), thor, None, Mb @ T(0, -0.47, 0.30))      # 小盾板
    if orn:
        for side in (-1, 1):   # 女王：はねの付け根の光るとげ
            b = V(side * 0.36, 0.30, 0.28)
            kit.add(C.tube([b, b + V(side * 0.22, 0.10, 0.20)], [0.07, 0.0], 7), ember, xf=Mb)
            b = V(side * 0.30, -0.40, 0.30)
            kit.add(C.tube([b, b + V(side * 0.16, -0.18, 0.22)], [0.06, 0.0], 7), ember, xf=Mb)
    kit.add(C.tube([V(0, -0.55, -0.05), V(0, -0.80, -0.10)], [0.12, 0.10], 8), thor, xf=Mb)   # 腹柄

    # --- 頭 -----------------------------------------------------------------------------
    Mh = Mb @ T(0, 0.50, 0.02) @ Rx(-P["head"])
    kit.add(blob((0.60, 0.36, 0.48), 24, 14), headm, xf=Mh @ T(0, 0.30, 0.02))
    kit.add(blob((0.28, 0.13, 0.20), 16, 8), headm, xf=Mh @ T(0, 0.60, -0.14))       # 頭盾
    for side in (-1, 1):
        kit.add(blob((0.16, 0.22, 0.31), 14, 10), eye,
                xf=Mh @ T(side * 0.44, 0.40, 0.08) @ Rz(side * 22) @ Ry(side * 10))
        bared = orn or P["mand"] >= 0.9          # 攻撃の瞬間は歯が光る
        lk = Q.get("limb", 1.0)
        _wasp_mandible(kit, Mh, side, P["mand"], dark, ember if bared else dark, lk ** 0.5, lk ** 0.8)
        if Q.get("antenna", True):
            _wasp_antenna(kit, Mh, side, P["ant"], dark, th, lk)
    for p in (V(0, 0.48, 0.40), V(-0.11, 0.40, 0.44), V(0.11, 0.40, 0.44)):         # 単眼
        r = 0.065 if orn else 0.055
        kit.add(blob((r, r, r), 8, 6), eye, xf=Mh @ T(p))
    if orn:   # 女王：頭の両わきの冠（外へ反る光るとげ）
        for k, side in ((k, s) for k in range(3) for s in (-1, 1)):
            b = V(side * (0.40 + 0.06 * k), 0.34 - 0.12 * k, 0.32 - 0.04 * k)
            L = 0.40 - 0.08 * k
            d = V(side * 0.85, 0.10 - 0.25 * k, 0.45).normalized()
            kit.add(C.tube([b, b + d * (L * 0.6) + V(0, 0, 0.04), b + d * L + V(0, 0, 0.10)],
                           [0.085, 0.05, 0.0], 7), ember if k < 2 else dark, xf=Mh)

    # --- 腹（節ごとに少しふくらみ、後ろのふちが光る帯）-----------------------------
    Lg = Q["gaster"]
    segs = GASTER_SEGS

    def env(u):
        r = pw(u, (0, 0.05, 0.16, 0.34, 0.52, 0.72, 0.88, 1.0), (0.10, 0.24, 0.45, 0.56, 0.56, 0.46, 0.28, 0.06))
        for j in range(1, len(segs) - 1):
            if segs[j - 1] <= u < segs[j]:
                t = (u - segs[j - 1]) / (segs[j] - segs[j - 1])
                r *= 0.92 + 0.08 * t
        return r

    def g_prof(u):
        r = env(u)
        return r, r * 0.86, 0.0

    nb = 5 if orn else 4

    def g_fn(ring, fc):
        c = fc.calc_center_median()
        u = -c.y / Lg
        r = max(env(min(max(u, 0.0), 1.0)), 1e-3)
        zn = c.z / (r * 0.86)
        for j in range(1, nb + 1):
            lo, hi = segs[j - 1], segs[j]
            if hi - (hi - lo) * 0.36 <= u < hi and zn > -0.55:
                return band
        if orn and u > 0.86 and zn > -0.2:
            return band
        return None
    sx = [bend(P["curl"], 0.25), Mb @ T(0, -0.80, -0.10) @ Rx(P["gp"])]
    kit.add(lathe(profile_samples(g_prof, Lg, 44), 24), gas, g_fn, sx)
    # 針（腹の先から、さらに突き出す）
    Ls = Q["sting"] + P["ext"]
    s0 = Lg - 0.08
    kit.add(C.tube([V(0, -s0, -0.02), V(0, -(s0 + Ls * 0.5), -0.03), V(0, -(s0 + Ls), -0.05)],
                   [0.13 if orn else 0.06, 0.08 if orn else 0.04, 0.0], 8), ember if orn or P["ext"] > 0 else thor,
            None, sx)

    # --- 脚 -----------------------------------------------------------------------------
    for i, (hy, a, b, c) in enumerate(((0.32, 0.50, 0.55, 0.40), (0.02, 0.58, 0.62, 0.45),
                                       (-0.28, 0.68, 0.78, 0.55))):
        for side in (-1, 1):
            lk = Q.get("limb", 1.0)
            _wasp_leg(kit, Mb, side, i, hy, a * lk, b * lk, c * lk, P["legs"], legm, th)

    # --- はね ---------------------------------------------------------------------------
    for side in (-1, 1):
        _wing(kit, Mb @ T(side * 0.34, 0.24, 0.30), side, Q["fore"], P["fphi"], P["fpsi"], wingm, vein, th=th)
        _wing(kit, Mb @ T(side * 0.32, -0.12, 0.26), side, Q["hind"], P["hphi"], P["hpsi"], wingm, vein,
              hind=True, th=th)
    return kit


def _wasp_mandible(kit, Mh, side, open_, mat, tooth, th=1.0, k=1.0):
    """大あご：外へ張り出してから内へ曲がる。open_ で開く。内側に歯。"""
    B = V(side * 0.22, 0.54, -0.26)
    a = math.radians(side * (4 + 38 * open_))
    R = Matrix.Rotation(a, 4, "Z")
    pts = [V(0, 0, 0), V(side * 0.18, 0.26, -0.03), V(side * 0.10, 0.52, -0.06), V(-side * 0.04, 0.66, -0.08)]
    pts = [Mh @ (T(B) @ R @ (p * k)) for p in pts]
    kit.add(C.tube(pts, [0.12 * th, 0.105 * th, 0.08 * th, 0.02], 10), mat)
    inward = (Mh.to_3x3() @ (R.to_3x3() @ V(-side, 0.35, 0))).normalized()
    for p, L in ((pts[1].lerp(pts[2], 0.5), 0.12), (pts[2], 0.12), (pts[2].lerp(pts[3], 0.5), 0.09)):
        kit.add(C.tube([p, p + inward * L * k], [0.06 * th, 0.0], 6), tooth)   # 内側の歯


def _wasp_antenna(kit, Mh, side, sway, mat, th=1.0, k=1.0):
    b0 = V(side * 0.13, 0.58, 0.14)
    e = b0 + V(side * 0.14, 0.18, 0.40) * k
    m = e + V(side * 0.40, 0.42 + 0.04 * sway, -0.02) * k
    t = m + V(side * 0.32, 0.30, -0.18 + 0.05 * sway) * k
    pts = [Mh @ p for p in (b0, e, m, t)]
    kit.add(C.tube(pts, [0.055 * th, 0.050 * th, 0.050 * th, 0.048 * th], 7), mat)


def _wasp_leg(kit, Mb, side, i, hy, a, b, c, mode, mat, th=1.0):
    hip = V(side * 0.22, hy, -0.30)
    if mode == "hang":   # ぶら下げる（後脚ほど後ろへ）
        fd = V(side * 0.55, 0.15 - 0.25 * i, -0.80)
        td = V(side * 0.25, -0.20 - 0.25 * i, -0.95)
        cd = V(side * 0.10, -0.60 - 0.15 * i, -0.75)
    elif mode == "reach":   # 前へのばす
        fd = V(side * 0.55, 0.55 - 0.30 * i, -0.55)
        td = V(side * 0.15, 0.70 - 0.45 * i, -0.70)
        cd = V(side * 0.0, 0.80 - 0.50 * i, -0.50)
    elif mode == "spread":   # 横へ大きく広げる（針を突き出すとき、脚がじゃまにならないように）
        fd = V(side * 0.90, 0.30 - 0.35 * i, -0.15)
        td = V(side * 0.65, 0.35 - 0.45 * i, -0.65)
        cd = V(side * 0.30, 0.30 - 0.45 * i, -0.70)
    else:   # strike：つかみかかる（爪を前へ広げる）
        fd = V(side * 0.70, 0.60 - 0.35 * i, -0.38)
        td = V(side * 0.25, 0.85 - 0.50 * i, -0.45)
        cd = V(side * 0.05, 0.80 - 0.50 * i, -0.55)
    K = hip + fd.normalized() * a
    A = K + td.normalized() * b
    F = A + cd.normalized() * c
    pts = [Mb @ p for p in (hip, K, A, F)]
    kit.add(C.tube(pts, [0.085 * th, 0.070 * th, 0.055 * th, 0.045 * th], 8), mat)


def _wing(kit, M, side, size, phi, psi, mat, vein_mat, hind=False, th=1.0):
    L, ch = size
    bm = blob((ch / 2, L / 2, 0.03), 12, 18)
    bmesh.ops.transform(bm, matrix=Rz(-90), verts=bm.verts)          # 長い軸を +X に
    bmesh.ops.transform(bm, matrix=T(L / 2, 0, 0), verts=bm.verts)
    for v in bm.verts:
        u = v.co.x / L
        v.co.y = v.co.y * (0.28 + 0.72 * smooth(u / 0.42)) - ch * (0.10 * u * u) + ch * 0.06
    veins = [[(0.04, 0.06), (0.55, 0.20), (0.92, 0.12)],
             [(0.04, 0.0), (0.45, 0.02), (0.78, -0.08)],
             [(0.10, -0.06), (0.40, -0.20), (0.62, -0.30)]]
    if hind:
        veins = veins[:2]
    if side < 0:
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((-1, 1, 1, 1)), verts=bm.verts)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    R = M @ Rz(side * psi) @ Ry(-side * phi)
    kit.add(bm, mat, None, R, wing=True)
    for vp in veins:
        pts = [V(side * L * u, ch * w, 0.028) for u, w in vp]
        kit.add(C.tube(pts, [0.030 * th, 0.030 * th, 0.026 * th], 5), vein_mat, None, R, wing=True)


# ===========================================================================
def build(boss, anim, frame, layer="all", name=None):
    kit = Kit(layer)
    if boss == "mantis":
        mantis(kit, anim, frame)
    elif boss == "spider":
        spider(kit, anim, frame)
    elif boss == "hornet":
        wasp(kit, anim, frame, HORNET)
    elif boss == "queen":
        wasp(kit, anim, frame, QUEEN)
    elif boss == "minion":
        wasp(kit, anim, frame, MINION)
    else:
        raise ValueError(boss)
    return kit.finish(name or f"{boss}_{anim}{frame}_{layer}", BOSSES[boss].get("scale", 1.0))
