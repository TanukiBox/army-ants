"""Blender 内で使う共通の道具（シーン初期化・塗り分けマテリアル・メッシュ・カメラ）。

このファイルは Blender の中で動きます（build.py から自動で呼ばれます）。
Oh!Edo Taco Tuesday!! の art/blender/common.py をもとに、アリ用に作り直したものです。
"""
import math
import os
import random
import sys
import zlib

import bpy
import bmesh
from mathutils import Vector, Matrix

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ART not in sys.path:
    sys.path.insert(0, ART)
from pipeline.palette import RAMPS, GLOWS  # noqa: E402

# ---------------------------------------------------------------------------
# 見下ろしの角度と、光の向き（全部の絵で共通）
# ---------------------------------------------------------------------------
ELEVATION_DEG = 58.0                     # カメラの見下ろし角度（真上が 90）
_E = math.radians(ELEVATION_DEG)
VIEW = Vector((0.0, -math.cos(_E), math.sin(_E)))   # 物からカメラへ向かう向き
KEY = Vector((-0.55, -0.30, 0.78)).normalized()     # 主な光：左上・手前から
RIM = Vector((0.35, 0.85, 0.40)).normalized()       # 縁の光：奥（画面の上）から


def rng_for(name):
    """名前から作った固定の種の乱数（毎回同じ結果になる）。"""
    return random.Random(zlib.crc32(name.encode("utf-8")))


# ---------------------------------------------------------------------------
# シーン
# ---------------------------------------------------------------------------
def reset_scene():
    """シーンを空にして、レンダリング設定を毎回同じ値にそろえる。"""
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.lights, bpy.data.cameras, bpy.data.images,
                 bpy.data.worlds, bpy.data.curves):
        for item in list(coll):
            coll.remove(item)
    scene = bpy.context.scene
    r = scene.render
    r.engine = "CYCLES"
    r.film_transparent = True
    r.resolution_percentage = 100
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.use_file_extension = True
    c = scene.cycles
    c.device = "CPU"
    # 色は光の計算ではなく「塗り分けの段」で決めるので、1サンプルで十分。
    # 細かい拡大画像を描き、ドット絵変換のときにまとめて縮める。
    c.samples = 1
    c.use_adaptive_sampling = False
    c.use_denoising = False
    c.seed = 0
    c.use_animated_seed = False
    c.pixel_filter_type = "BOX"
    c.filter_width = 0.01
    c.max_bounces = 0
    c.diffuse_bounces = 0
    c.glossy_bounces = 0
    c.transmission_bounces = 0
    c.transparent_max_bounces = 0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    w = bpy.data.worlds.new("Black")
    scene.world = w
    try:
        w.use_nodes = True
        for n in w.node_tree.nodes:
            if n.type == "BACKGROUND":
                n.inputs["Color"].default_value = (0, 0, 0, 1)
                n.inputs["Strength"].default_value = 0.0
    except Exception:
        w.color = (0, 0, 0)
    scene.frame_set(1)
    return scene


def set_resolution(w, h):
    r = bpy.context.scene.render
    r.resolution_x = w
    r.resolution_y = h


def render_to(path):
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("  rendered:", path, flush=True)


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def oblique_camera(ortho_scale, target=(0, 0, 0), name="Cam"):
    """斜め上から見下ろす正投影カメラ（画面の上 = 奥 = +Y）。"""
    cd = bpy.data.cameras.new(name)
    cd.type = "ORTHO"
    cd.ortho_scale = ortho_scale
    cd.clip_start = 0.01
    cd.clip_end = 400.0
    ob = link(bpy.data.objects.new(name, cd))
    t = Vector(target)
    ob.location = t + VIEW * 60.0
    ob.rotation_euler = (-VIEW).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def screen_to_ground(u, v):
    """画面上のずれ（右 u・上 v、単位はワールドの長さ）→ 地面（z=0）の位置。"""
    return Vector((u, v / math.sin(_E), 0.0))


# ---------------------------------------------------------------------------
# 色
# ---------------------------------------------------------------------------
def hex_rgb(h):
    """'#RRGGBB' → Blender のリニア色 (r, g, b)。"""
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def _new_emission_material(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m, nt, em


def _dot(nt, a_socket, vec):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = "DOT_PRODUCT"
    nt.links.new(a_socket, n.inputs[0])
    n.inputs[1].default_value = tuple(vec)
    return n.outputs["Value"]


def _math(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _ramp(nt, fac, stops):
    cr = nt.nodes.new("ShaderNodeValToRGB")
    ramp = cr.color_ramp
    ramp.interpolation = "CONSTANT"
    els = ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*hex_rgb(col), 1.0)
    nt.links.new(fac, cr.inputs["Fac"])
    return cr.outputs["Color"]


def toon_material(name, ramp, light=(0.42, 0.78), rim=0.55, spec=(0.86, 0.965), use_rim=True,
                  tone_attr=None):
    """塗り分けマテリアル。光の向きで「影・地・明」、奥からの光で「縁」、
    鏡のような反射で「つや・つやの芯」の段に分ける（色はパレットの色そのまま）。

    ramp: RAMPS の名前（6色）
    light: 明るさで段を分ける境目（0〜1）
    rim: 縁の光が出る境目（大きいほど細い）
    spec: つや・つやの芯が出る境目
    tone_attr: 頂点の属性（0〜1）の名前。明るさの境目をずらして色むらを作る
    """
    m = bpy.data.materials.get(name)
    if m:
        return m
    cols = RAMPS[ramp]
    m, nt, em = _new_emission_material(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nrm = geo.outputs["Normal"]
    # 0.05 影 / 0.25 地 / 0.45 明
    d = _math(nt, "MULTIPLY_ADD", _dot(nt, nrm, KEY), 0.5)
    d.node.inputs[2].default_value = 0.5
    if tone_attr:
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = tone_attr
        d = _math(nt, "ADD", d, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", at.outputs["Fac"], 0.5), 0.6))
    t = _math(nt, "ADD", 0.05, _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", d, light[0]), 0.2))
    t = _math(nt, "ADD", t, _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", d, light[1]), 0.2))
    # 縁の光（0.65）
    if use_rim:
        r = _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", _dot(nt, nrm, RIM), rim), 0.65)
        t = _math(nt, "MAXIMUM", t, r)
    # つや（0.8 / 0.95）：主な光の反射がカメラに向かう所
    half = (KEY + VIEW).normalized()
    s = _dot(nt, nrm, half)
    t = _math(nt, "MAXIMUM", t, _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", s, spec[0]), 0.8))
    t = _math(nt, "MAXIMUM", t, _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", s, spec[1]), 0.95))
    col = _ramp(nt, t, [(0.0, cols[0]), (0.2, cols[1]), (0.4, cols[2]),
                        (0.6, cols[3]), (0.75, cols[4]), (0.9, cols[5])])
    nt.links.new(col, em.inputs["Color"])
    return m


def glow_material(name, glow, core=0.975, deep=0.30, dim=False):
    """光る部分。正面（カメラに向いた所）は「芯」、ふちは「深い色」、ほかは「本体」の色。
    dim=True は控えめ（ほとんど「深い色」で、真ん中だけ本体の色）。"""
    m = bpy.data.materials.get(name)
    if m:
        return m
    cols = GLOWS[glow]
    m, nt, em = _new_emission_material(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    f = _dot(nt, geo.outputs["Normal"], VIEW)
    stops = [(0.0, cols[2]), (0.995, cols[1])] if dim else [(0.0, cols[2]), (deep, cols[1]), (core, cols[0])]
    col = _ramp(nt, f, stops)
    nt.links.new(col, em.inputs["Color"])
    return m


def flat_material(name, hex_color):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m, nt, em = _new_emission_material(name)
    em.inputs["Color"].default_value = (*hex_rgb(hex_color), 1.0)
    return m


# ---------------------------------------------------------------------------
# メッシュ（部品を1つのメッシュにまとめて作る）
# ---------------------------------------------------------------------------
class Parts:
    """部品（bmesh）を材質ごとに集めて、最後に1つのメッシュにする。"""

    def __init__(self):
        self.bm = bmesh.new()
        self.materials = []

    def mat_index(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def add(self, src, mat, mat_fn=None):
        """src（bmesh）を追加する。mat_fn(ring, face) があれば、面ごとに材質を選べる
        （ring は ellipsoid() の前から何番目の輪か。輪がない部品は -1）。"""
        vmap = {}
        for v in src.verts:
            vmap[v] = self.bm.verts.new(v.co)
        default = self.mat_index(mat)
        lay = src.faces.layers.int.get("ring")
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            m2 = mat_fn(f[lay] if lay is not None else -1, f) if mat_fn else None
            nf.material_index = self.mat_index(m2) if m2 is not None else default
            nf.smooth = f.smooth
        src.free()

    def to_mesh(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.materials:
            me.materials.append(m)
        return me


def ellipsoid(center, radii, segs=16, rings=10, rot=None, smooth=True):
    """体の軸（+Y）に沿った楕円体。面には ring（前0〜後ろ rings-1）を覚えさせる。

    rot: 中心まわりの回転（Matrix 3x3）
    """
    bm = bmesh.new()
    rlay = bm.faces.layers.int.new("ring")
    cx, cy, cz = center
    rx, ry, rz = radii
    front = bm.verts.new((0, ry, 0))
    back = bm.verts.new((0, -ry, 0))
    grid = []
    for i in range(1, rings):
        v = math.pi * i / rings
        y = ry * math.cos(v)
        s = math.sin(v)
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            row.append(bm.verts.new((rx * s * math.cos(a), y, rz * s * math.sin(a))))
        grid.append(row)
    for j in range(segs):
        k = (j + 1) % segs
        f = bm.faces.new((front, grid[0][k], grid[0][j]))
        f[rlay] = 0
        f = bm.faces.new((back, grid[-1][j], grid[-1][k]))
        f[rlay] = rings - 1
    for i in range(len(grid) - 1):
        for j in range(segs):
            k = (j + 1) % segs
            f = bm.faces.new((grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j]))
            f[rlay] = i + 1
    for f in bm.faces:
        f.smooth = smooth
    m = Matrix.Translation((cx, cy, cz))
    if rot is not None:
        m = m @ rot.to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def dome(bm, center_z, keep_above=0.0):
    """楕円体の下半分を消して、甲羅のような「ふた」にする。"""
    gone = [f for f in bm.faces if f.calc_center_median().z < center_z + keep_above]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    return bm


def tube(points, radii, segs=8, cap=True, smooth=True):
    """points（中心線）に沿って radii の太さの管を作る（脚・触角・顎・針）。"""
    bm = bmesh.new()
    rings = []
    n = len(points)
    pts = [Vector(p) for p in points]
    for i, (p, r) in enumerate(zip(pts, radii)):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = t.cross(Vector((0, 1, 0)))
        side.normalize()
        up = side.cross(t).normalized()
        if r <= 1e-5:
            rings.append([bm.verts.new(p)])
            continue
        rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * j / segs)
                                         + up * math.sin(2 * math.pi * j / segs)) * r)
                      for j in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(segs):
            k = (j + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[k]))
            elif len(b) == 1:
                bm.faces.new((a[j], a[k], b[0]))
            else:
                bm.faces.new((a[j], a[k], b[k], b[j]))
    if cap:
        if len(rings[0]) > 2:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 2:
            bm.faces.new(rings[-1])
    for f in bm.faces:
        f.smooth = smooth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def add_tone_attr(me, fn, name="tone"):
    """頂点ごとの値（0〜1）を属性にする。toon_material(tone_attr=...) の色むらに使う。"""
    attr = me.attributes.new(name, "FLOAT", "POINT")
    attr.data.foreach_set("value", [fn(v.co) for v in me.vertices])
    return me


def transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def mirror_x(points):
    return [(-x, y, z) for x, y, z in points]
