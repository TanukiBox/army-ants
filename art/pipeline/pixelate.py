"""ドット絵変換：大きく描いた元画像 → 小さなドット絵（色の画像＋発光用の画像）。

Oh!Edo Taco Tuesday!! の pixelate.py をもとに、小さなアリ（16〜24px）向けに変えたもの。
  1. 減色：元画像の1点ずつを、パレットの一番近い色に置き換える（人の目に近い OKLab 色空間）
  2. 縮小：ss×ss 点のかたまりを1ドットにする。
     - そのかたまりの何割が塗られているかで「塗る／透明」を決める（細い脚も残るように）
     - 色は「一番多い色」を選ぶ（色を混ぜないので、にじまない）。光る色は細くても残るよう重みを付ける
  3. 発光用の画像：光る色（パレットの GLOWS）のドットだけを抜き出した画像
同じ入力からは、毎回まったく同じ PNG ができます（乱数を使いません）。
"""
import numpy as np
from PIL import Image

from .palette import PALETTE, OUTLINE, GLOW_COLORS, GLOWS, WHITE_CORE, rgb

PALETTE_RGB = np.array([rgb(h) for h in PALETTE], dtype=np.float64)
GLOW_INDEX = np.array([PALETTE.index(c) for c in GLOW_COLORS])
OUTLINE_INDEX = PALETTE.index(OUTLINE)
CORE_INDEX = PALETTE.index(WHITE_CORE)


def _srgb_to_oklab(c):
    c = c / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    lms = np.cbrt(lin @ m1.T)
    return lms @ m2.T


PALETTE_LAB = _srgb_to_oklab(PALETTE_RGB)


def quantize(arr):
    """(H, W, 3) の 0〜255 → パレット番号 (H, W)。輪郭色は輪郭専用なので選ばない。
    同じ色はまとめて1回だけ計算する（元画像はほとんどパレットの色そのままなので速い）。"""
    h, w, _ = arr.shape
    packed = (arr[..., 0].astype(np.int64) << 16) | (arr[..., 1].astype(np.int64) << 8) | arr[..., 2]
    uniq, inv = np.unique(packed.ravel(), return_inverse=True)
    cols = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], -1).astype(np.float64)
    lab = _srgb_to_oklab(cols)
    d = ((lab[:, None, :] - PALETTE_LAB[None, :, :]) ** 2).sum(-1)
    d[:, OUTLINE_INDEX] = np.inf
    return d.argmin(-1)[inv].reshape(h, w)


def weights():
    """一番多い色を選ぶときの重み。光る色は細くても残るよう強くする。"""
    wts = np.ones(len(PALETTE))
    wts[GLOW_INDEX] = 1.8
    wts[CORE_INDEX] = 1.6       # 白い芯は控えめに（光る色の本体を優先）
    return wts


def downsample(img, ss, coverage=0.34):
    """ss×ss の点を1ドットにまとめる。戻り値：(パレット番号, 不透明マスク)"""
    a = np.asarray(img.convert("RGBA"))
    H, W = a.shape[0] // ss, a.shape[1] // ss
    a = a[:H * ss, :W * ss]
    alpha = a[..., 3] >= 128
    idx = quantize(a[..., :3])
    # かたまりごとに並べ替え：(H, W, ss*ss)
    blk_idx = idx.reshape(H, ss, W, ss).transpose(0, 2, 1, 3).reshape(H, W, ss * ss)
    blk_a = alpha.reshape(H, ss, W, ss).transpose(0, 2, 1, 3).reshape(H, W, ss * ss)
    cov = blk_a.mean(-1)
    opaque = cov >= coverage
    n = len(PALETTE)
    counts = np.zeros((H, W, n))
    for k in range(ss * ss):
        ii, jj = np.nonzero(blk_a[..., k])
        counts[ii, jj, blk_idx[ii, jj, k]] += 1   # 同じ k の中では (ii, jj) は重ならない
    counts *= weights()[None, None, :]
    best = counts.argmax(-1)
    return best, opaque


def outline(index, opaque):
    """絵のまわり（外側）に 1px の暗い線を引く（上下左右）。"""
    grown = opaque.copy()
    grown[1:, :] |= opaque[:-1, :]
    grown[:-1, :] |= opaque[1:, :]
    grown[:, 1:] |= opaque[:, :-1]
    grown[:, :-1] |= opaque[:, 1:]
    edge = grown & ~opaque
    index = index.copy()
    index[edge] = OUTLINE_INDEX
    return index, grown


def to_image(index, opaque):
    out = np.zeros(index.shape + (4,), dtype=np.uint8)
    out[..., :3] = PALETTE_RGB[index].astype(np.uint8)
    out[..., 3] = np.where(opaque, 255, 0)
    out[~opaque, :3] = 0
    return Image.fromarray(out, "RGBA")


def glow_image(index, opaque):
    """光る色のドットだけを残した発光用の画像。"""
    glow = np.isin(index, GLOW_INDEX) & opaque
    return to_image(index, glow)


# 光る色 → 「消えているときの色」（色の画像ではこちらを使い、明るさはゲーム側で足す）
_FAMILY = {}
for _fam, (_core, _main, _deep) in GLOWS.items():
    _FAMILY[PALETTE.index(_main)] = PALETTE.index(_deep)
    _FAMILY[PALETTE.index(_deep)] = PALETTE.index(_deep)


def unlit(index):
    """光る部分を、光っていないときの暗い色にする。
    白い芯はまわりの光る色の仲間（多い方）の暗い色にする。"""
    out = index.copy()
    for src, dst in _FAMILY.items():
        out[index == src] = dst
    core = np.argwhere(index == CORE_INDEX)
    H, W = index.shape
    for y, x in core:
        votes = {}
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and int(index[yy, xx]) in _FAMILY:
                    d = _FAMILY[int(index[yy, xx])]
                    votes[d] = votes.get(d, 0) + 1
        out[y, x] = max(votes, key=votes.get) if votes else OUTLINE_INDEX   # 光っていない白い芯は暗い割れ目に
    return out


def pixelate(src_path, ss, with_outline=False, coverage=0.34, glow_split=False):
    """大きな元画像 → (色の画像, 発光用の画像)
    glow_split=True：色の画像の光る部分は暗い色にし、明るい色は発光用の画像だけに入れる
    （ゲーム側で光の強さを変えたり、脈打たせたりできる）"""
    src = Image.open(src_path)
    index, opaque = downsample(src, ss, coverage)
    if with_outline:
        index, opaque = outline(index, opaque)
    color = to_image(unlit(index) if glow_split else index, opaque)
    return color, glow_image(index, opaque)


def save_png(img, path):
    img.save(path, format="PNG", optimize=True)
