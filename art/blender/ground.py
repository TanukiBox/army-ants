"""地面の部品：土のタイル（すき間なく並べられる）と、落ち葉・小石・小枝。

土のタイルは「周期のあるノイズ」で凸凹を作り、同じ形を 3×3 に並べて真ん中だけを写す。
そのため、ゲームで上下左右に並べても継ぎ目が出ない。
"""
import math

import bmesh
import bpy
from mathutils import Vector, Matrix

import common as C


# ---------------------------------------------------------------------------
# 周期のあるなめらかなノイズ（px, py ごとに同じ値に戻る）
# ---------------------------------------------------------------------------
def _hash01(ix, iy, k):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (k * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFFFF) / 0xFFFFFF


def periodic_noise(x, y, nx, ny, k=0):
    """0〜1 の値。x は 0〜nx、y は 0〜ny の格子で1周する。"""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def v(i, j):
        return _hash01((ix + i) % nx, (iy + j) % ny, k)
    a = v(0, 0) + (v(1, 0) - v(0, 0)) * sx
    b = v(0, 1) + (v(1, 1) - v(0, 1)) * sx
    return a + (b - a) * sy


def fbm(u, v, base, octaves, k):
    """u, v は 0〜1（タイル内の位置）。base は一番粗い格子の数。"""
    s, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        n = base * (2 ** o)
        s += periodic_noise(u * n, v * n, n, n, k + o * 17) * amp
        tot += amp
        amp *= 0.5
    return s / tot


# ---------------------------------------------------------------------------
# 土のタイル
# ---------------------------------------------------------------------------
# エリアごとの地面：色の段・盛り上がりの強さ・ひびの多さ・砂つぶ・繊維のすじ・苔の色の段
SOIL_STYLES = {
    "garden": dict(ramp="soil", amp=0.40, crack=0.025, grit=0.74, fiber=0.0, patch=None),
    "forest": dict(ramp="soil", amp=0.46, crack=0.010, grit=0.78, fiber=0.0, patch="grass"),
    "hive":   dict(ramp="clay", amp=0.26, crack=0.018, grit=0.84, fiber=0.035, patch=None),
}


def soil_tile(w, h, res=160, area="garden"):
    """w × h（地面の長さ）の土。3×3 に並べた凸凹のメッシュを返す。
    area でエリアの地面（庭の土・森の落ち葉と苔・スズメバチの巣のまわりの木くず）を変える。"""
    st = SOIL_STYLES[area]
    ry = int(round(res * h / w))
    # 1周期ぶんだけ計算して、3×3 に使い回す（周期があるので継ぎ目が出ない）
    zs, tones, moss = [], [], []
    for j in range(ry):
        zr, tr, mr = [], [], []
        for i in range(res):
            fu, fv = i / res, j / ry
            # 粗い土くれ＋細かいざらつき＋ところどころの小石の盛り上がり
            z = (fbm(fu, fv, 5, 4, 1) - 0.5) * st["amp"]
            z += (fbm(fu, fv, 20, 2, 9) - 0.5) * 0.12
            crack = abs(fbm(fu, fv, 7, 2, 31) - 0.5)          # ひび割れ（細い溝）
            if crack < st["crack"]:
                z -= (st["crack"] - crack) * 5.0
            grit = fbm(fu, fv, 56, 1, 23)                     # 細かい砂つぶ
            if grit > st["grit"]:
                z += (grit - st["grit"]) * 0.8
            if st["fiber"]:                                   # 木くず（スズメバチの巣の紙）のすじ
                z += math.sin((fu * 2 + fbm(fu, fv, 4, 2, 57) * 1.5) * math.pi * 2 * 9) * st["fiber"]
            m = st["patch"] and fbm(fu, fv, 9, 3, 77) * 0.7 + fbm(fu, fv, 30, 1, 78) * 0.3 > 0.60
            if m:
                z += 0.05 + (fbm(fu, fv, 48, 1, 79) - 0.5) * 0.12   # 苔はふかふか盛り上がる
            zr.append(z)
            tr.append(fbm(fu, fv, 3, 3, 41))          # 色のむら（湿った所・乾いた所）
            mr.append(m)
        zs.append(zr)
        tones.append(tr)
        moss.append(mr)
    bm = bmesh.new()
    nx, ny = res * 3, ry * 3
    verts, vals = [], []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x, y = (i / res - 1.5) * w, (j / ry - 1.5) * h
            row.append(bm.verts.new((x, y, zs[j % ry][i % res])))
            vals.append(tones[j % ry][i % res])
        verts.append(row)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            f.smooth = True
            if moss[j % ry][i % res]:      # 苔の生えた所
                f.material_index = 1
    me = bpy.data.meshes.new("soil_" + area)
    bm.to_mesh(me)
    bm.free()
    attr = me.attributes.new("tone", "FLOAT", "POINT")   # 頂点は作った順に並ぶ
    attr.data.foreach_set("value", vals)
    me.materials.append(C.toon_material("soil_" + st["ramp"], st["ramp"], light=(0.40, 0.70), rim=0.75,
                                        spec=(0.99, 0.999), tone_attr="tone"))
    if st["patch"]:
        me.materials.append(C.toon_material("moss", st["patch"], light=(0.35, 0.70), rim=0.7,
                                            spec=(0.99, 0.999), tone_attr="tone"))
    return me


# ---------------------------------------------------------------------------
# 落ち葉・小石・小枝
# ---------------------------------------------------------------------------
def _leaf_outline(kind, length, width, rng, n=48):
    """葉の外形（xy の点の並び）。
    kind: "oval" 先がとがった卵形 / "long" 細長い / "maple" 5つに分かれた手のひら形"""
    pts = []
    if kind == "maple":
        for i in range(n):
            a = 2 * math.pi * i / n
            lobe = abs(math.cos(a * 2.5)) ** 2.2           # 5つの先
            r = width * (0.42 + 0.58 * lobe) * (0.9 + 0.1 * rng.random())
            if math.sin(a) < -0.85:                        # 付け根のくぼみ
                r *= 0.55
            pts.append((r * math.cos(a), r * math.sin(a) + width * 0.15))
        return pts
    half = n // 2
    for side in (1, -1):
        rng_i = range(half + 1) if side == 1 else range(half - 1, 0, -1)
        for i in rng_i:
            s = i / half                                       # 0 付け根 → 1 先
            if kind == "long":
                w = width * math.sin(math.pi * s) ** 0.9 * (1.0 - 0.25 * s)
            else:
                w = width * math.sin(math.pi * s) ** 0.75 * (1.0 - 0.45 * s)
            w *= 0.94 + 0.06 * rng.random()
            pts.append((side * w, (s - 0.5) * length))
    return pts


def leaf(name, length, width, ramp, kind="oval", curl=0.25, holes=0):
    """平たい葉っぱ（少し反って、ねじれている）。真ん中と横の葉脈、付け根の柄つき。"""
    rng = C.rng_for(name)
    bm = bmesh.new()
    outline = _leaf_outline(kind, length, width, rng)
    rim = [bm.verts.new((x, y, 0.0)) for x, y in outline]
    face = bm.faces.new(rim)
    bmesh.ops.triangulate(bm, faces=[face])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    span = max(width, 1e-3)
    for v in bm.verts:
        # 反り（両側が持ち上がる）と、ゆるいねじれ、先の持ち上がり
        v.co.z += curl * (v.co.x / span) ** 2 * span * 0.6 + 0.06 * v.co.y * v.co.x / span
        v.co.z += 0.10 * max(0.0, v.co.y / length) ** 2 * length * 0.3
        v.co.z += 0.22 * abs(v.co.x)                   # 真ん中の筋で少し折れている
    for f in bm.faces:
        f.smooth = True
    parts = C.Parts()
    parts.add(bm, C.toon_material(ramp, ramp, light=(0.55, 0.86), rim=0.8, spec=(0.97, 0.995),
                                  tone_attr="tone"))
    dark = C.toon_material(ramp + "_vein", ramp, light=(0.86, 0.97), use_rim=False, spec=(2, 2))
    # 葉脈：真ん中の筋と、斜めの筋
    top = length * 0.45 if kind != "maple" else width * 0.9
    z = 0.035
    parts.add(C.tube([(0, -length * 0.5 - 0.10, z), (0, -length * 0.5, z), (0, top, z)],
                     [0.020, 0.018, 0.004], 5), dark)
    if kind == "maple":
        for a in (0.55, 2.6, 1.57):
            d = (math.cos(a), math.sin(a))
            parts.add(C.tube([(0, 0, z), (d[0] * width * 0.85, d[1] * width * 0.85 + width * 0.15, z)],
                             [0.014, 0.003], 4), dark)
    else:
        for k in range(3):
            y0 = (-0.25 + 0.22 * k) * length
            for sx in (-1, 1):
                parts.add(C.tube([(0, y0, z), (sx * width * 0.55, y0 + width * 0.45, z)],
                                 [0.011, 0.003], 4), dark)
    k = rng.randrange(1000)
    return C.add_tone_attr(parts.to_mesh(name),
                           lambda co: periodic_noise(co.x * 2.5 + 50, co.y * 2.5 + 50, 256, 256, k))

def pebble(name, size, ramp="stone"):
    rng = C.rng_for(name)
    bm = C.ellipsoid((0, 0, size * 0.25), (size * (0.8 + 0.3 * rng.random()), size * (0.7 + 0.3 * rng.random()),
                                          size * 0.45), 14, 10)
    for v in bm.verts:
        v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.08
    parts = C.Parts()
    parts.add(bm, C.toon_material(ramp, ramp, rim=0.6, spec=(0.92, 0.99)))
    return parts.to_mesh(name)


def twig(name, length, thick):
    rng = C.rng_for(name)
    pts, radii = [], []
    n = 7
    for i in range(n):
        t = i / (n - 1)
        pts.append((rng.uniform(-0.03, 0.03) + 0.08 * math.sin(t * 3.0), (t - 0.5) * length, thick * 1.2))
        radii.append(thick * (1.0 - 0.45 * t))
    parts = C.Parts()
    wood = C.toon_material("leaf", "leaf", rim=0.7, spec=(0.95, 0.995))
    parts.add(C.tube(pts, radii, 8), wood)
    # 小さな枝分かれ
    b = Vector(pts[3])
    parts.add(C.tube([b, b + Vector((0.18 * length / 1.6, 0.16 * length / 1.6, 0.0))],
                     [thick * 0.6, thick * 0.3], 6), wood)
    return parts.to_mesh(name)


# 名前, 作り方, ゲームでの大きさの目安（cell 内に収める）
def grass(name, n=9, height=0.55):
    """草の株（庭）。細い葉が外へ反る。"""
    rng = C.rng_for(name)
    mat = C.toon_material("grass", "grass", light=(0.35, 0.75), rim=0.6)
    parts = C.Parts()
    for k in range(n):
        a = 2 * math.pi * k / n + rng.uniform(-0.3, 0.3)
        L = height * rng.uniform(0.6, 1.0)
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * 0.04, d * L * 0.35 + Vector((0, 0, L * 0.45)), d * L * 0.8 + Vector((0, 0, L * 0.55)),
               d * L * 1.1 + Vector((0, 0, L * 0.35))]
        parts.add(C.tube(pts, [0.05, 0.04, 0.03, 0.0], 5), mat)
    return parts.to_mesh(name)


def mushroom(name, n=3):
    """光るキノコ（森）。シイノトモシビタケのように、かさが緑に光る。"""
    rng = C.rng_for(name)
    stem = C.toon_material("mush_stem", "silk", light=(0.40, 0.80))
    cap = C.glow_material("glow_green_dim", "green", dim=True)
    parts = C.Parts()
    for k in range(n):
        x, y = rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2)
        hgt = rng.uniform(0.18, 0.34)
        r = rng.uniform(0.09, 0.15)
        parts.add(C.tube([(x, y, 0), (x + 0.02, y, hgt)], [0.03, 0.025], 6), stem)
        bm = C.ellipsoid((x + 0.02, y, hgt), (r, r, r * 0.55), 12, 8)
        C.dome(bm, hgt - r * 0.1)
        parts.add(bm, cap)
    return parts.to_mesh(name)


def moss(name, size=0.7):
    """苔のかたまり（森）。小さなこぶが集まる。"""
    rng = C.rng_for(name)
    mat = C.toon_material("moss_clump", "grass", light=(0.35, 0.72), rim=0.6)
    parts = C.Parts()
    for _ in range(14):
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(0, size * 0.6)
        s_ = rng.uniform(0.07, 0.14)
        parts.add(C.ellipsoid((r * math.cos(a), r * math.sin(a), s_ * 0.4), (s_, s_, s_ * 0.6), 8, 6), mat)
    return parts.to_mesh(name)


def paper(name, w=0.9, h=0.6):
    """スズメバチの巣の紙のかけら（最終エリア）。しま模様の曲がった殻。"""
    rng = C.rng_for(name)
    a_ = C.toon_material("paper_a", "clay", light=(0.30, 0.65))
    b_ = C.toon_material("paper_b", "amber", light=(0.45, 0.85))
    bm = bmesh.new()
    nx, ny = 10, 6
    vs = [[bm.verts.new(((i / nx - 0.5) * w, (j / ny - 0.5) * h,
                         0.25 * math.sin(math.pi * j / ny) * h + 0.02)) for i in range(nx + 1)]
          for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            f.smooth = True
    parts = C.Parts()

    def stripe(ring, f):
        return b_ if int((f.calc_center_median().y / h + 0.5) * 7) % 2 else None
    parts.add(bm, a_, stripe)
    me = parts.to_mesh(name)
    me.transform(Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "Z"))
    return me


DECOR = [
    ("leaf_brown_a", lambda: leaf("leaf_brown_a", 2.10, 0.62, "leaf", "oval")),
    ("leaf_brown_b", lambda: leaf("leaf_brown_b", 1.70, 0.55, "leaf", "oval", curl=0.5)),
    ("leaf_red_a", lambda: leaf("leaf_red_a", 1.0, 0.95, "leafred", "maple")),
    ("leaf_red_b", lambda: leaf("leaf_red_b", 1.60, 0.52, "leafred", "oval")),
    ("leaf_olive_a", lambda: leaf("leaf_olive_a", 2.30, 0.40, "leafolv", "long")),
    ("leaf_olive_b", lambda: leaf("leaf_olive_b", 1.0, 0.75, "leafolv", "maple", curl=0.4)),
    ("leaf_small_a", lambda: leaf("leaf_small_a", 1.10, 0.36, "leaf", "oval")),
    ("leaf_small_b", lambda: leaf("leaf_small_b", 0.95, 0.32, "leafred", "long")),
    ("pebble_a", lambda: pebble("pebble_a", 0.34)),
    ("pebble_b", lambda: pebble("pebble_b", 0.22)),
    ("pebble_c", lambda: pebble("pebble_c", 0.13)),
    ("pebble_d", lambda: pebble("pebble_d", 0.50)),
    ("twig_a", lambda: twig("twig_a", 2.40, 0.065)),
    ("twig_b", lambda: twig("twig_b", 1.60, 0.050)),
    ("grass_a", lambda: grass("grass_a", 9, 0.60)),
    ("grass_b", lambda: grass("grass_b", 6, 0.45)),
    ("mushroom_a", lambda: mushroom("mushroom_a", 3)),
    ("mushroom_b", lambda: mushroom("mushroom_b", 2)),
    ("moss_a", lambda: moss("moss_a", 0.8)),
    ("paper_a", lambda: paper("paper_a", 1.0, 0.65)),
    ("paper_b", lambda: paper("paper_b", 0.7, 0.5)),
]
