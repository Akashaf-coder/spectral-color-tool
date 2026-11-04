"""cospec.colorimetry — 光谱颜色模拟核心（纯 Python，零第三方依赖）。

与网页版 colorimetry.js 完全同源同口径，数值由 test/sdk_parity.py 对照
colour-science 生成的参考值回归（与网页版同一份 reference.json）。

口径（写死，勿改）：
  - 1nm 等间隔矩形法积分，取反射率/光源/观察者三者公共区间，5nm 数据线性插值到 1nm
  - 相对色度：k = 100 / Σ(S·ȳ·Δλ)，Y 归一 100
  - 参考白 = 完美漫反射体在该光源下的 XYZ，与样品同一波长网格积分
  - Lab 用光源白点当参考白（隐含完全色适应）
  - RGB 编码前做 Bradford 色适应（可关），把光源白点映射到显示空间白点
  - 色差：CIEDE2000（delta_e00）、CIE76（delta_e76）
"""
from __future__ import annotations

import math

from .data import DATA

D2R = math.pi / 180.0
SPACE_ORDER = DATA["space_order"]

BRADFORD = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
]
BRADFORD_INV = [
    [0.9869929, -0.1470543, 0.1599627],
    [0.4323053, 0.5183603, 0.0492912],
    [-0.0085287, 0.0400428, 0.9684867],
]


# ---------------- 光谱工具 ----------------

def sd_end(sd):
    return sd["start"] + sd["step"] * (len(sd["values"]) - 1)


def interp_at(sd, nm):
    i = (nm - sd["start"]) / sd["step"]
    if i < -1e-9 or i > len(sd["values"]) - 1 + 1e-9:
        return None
    i0 = int(math.floor(i))
    if i0 >= len(sd["values"]) - 1:
        return sd["values"][-1]
    f = i - i0
    return sd["values"][i0] * (1.0 - f) + sd["values"][i0 + 1] * f


def _common_range(*sds):
    return max(s["start"] for s in sds), min(sd_end(s) for s in sds)


def coerce_sd(x, label="光谱"):
    """把用户输入规范成 {"start","step","values"} 字典。

    接受三种形式：
      1. dict {"start":…, "step":…, "values":[…]}
      2. (start, step, values) 三元组
      3. [(波长, 数值), …] 一列对（间隔不一致时线性重采样到中位步长）
    """
    if isinstance(x, dict):
        if all(k in x for k in ("start", "step", "values")):
            return {"start": float(x["start"]), "step": float(x["step"]),
                    "values": [float(v) for v in x["values"]]}
        raise ValueError(f"{label} 字典需含 start/step/values 键")
    if isinstance(x, (list, tuple)):
        if len(x) == 3 and isinstance(x[1], (int, float)) and isinstance(x[2], (list, tuple)):
            return {"start": float(x[0]), "step": float(x[1]),
                    "values": [float(v) for v in x[2]]}
        pairs = []
        for row in x:
            if isinstance(row, (list, tuple)) and len(row) == 2:
                pairs.append((float(row[0]), float(row[1])))
            else:
                raise ValueError(f"{label} 无法解析：应是一列 (波长, 数值) 或 (start, step, values)")
        if len(pairs) < 2:
            raise ValueError(f"{label} 数据点不足 2 个")
        return _pairs_to_sd(pairs)
    raise ValueError(f"{label} 类型不支持：{type(x)!r}")


def _pairs_to_sd(pairs):
    pairs = sorted(pairs)
    wls = [p[0] for p in pairs]
    vals = [p[1] for p in pairs]
    diffs = sorted(b - a for a, b in zip(wls, wls[1:]))
    step = diffs[len(diffs) // 2]
    if step <= 0:
        raise ValueError("波长不是递增的，无法确定步长")
    if all(abs((b - a) - step) < step * 1e-6 for a, b in zip(wls, wls[1:])):
        return {"start": wls[0], "step": step, "values": vals}
    # 间隔不一致 → 线性重采样
    lo, hi = wls[0], wls[-1]
    count = int(math.floor((hi - lo) / step)) + 1
    out, j = [], 0
    for i in range(count):
        nm = lo + i * step
        while j < len(pairs) - 2 and pairs[j + 1][0] < nm - 1e-9:
            j += 1
        a, b = pairs[j], pairs[min(j + 1, len(pairs) - 1)]
        t = 0.0 if b[0] == a[0] else (nm - a[0]) / (b[0] - a[0])
        out.append(a[1] + (b[1] - a[1]) * t)
    return {"start": lo, "step": step, "values": out}


def illuminate(x):
    """光源：内置名（如 'D65'、'A'、'FL2'）或任意 SD（同 coerce_sd 的三种形式）。"""
    if isinstance(x, str):
        if x in DATA["illuminants"]:
            d = DATA["illuminants"][x]
            return {"start": d["start"], "step": d["step"], "values": d["values"]}
        raise ValueError(f"未知光源：{x!r}，可用 ILLUMINANTS 的键名")
    return coerce_sd(x, "光源")


ILLUMINANTS = {k: {"start": v["start"], "step": v["step"], "values": v["values"]}
               for k, v in DATA["illuminants"].items()}


# ---------------- 主计算 ----------------

def sd_to_xyz(refl, illum, observer="2deg", step=1):
    obs = DATA["cmfs"][observer]
    ox = {"start": obs["start"], "step": obs["step"], "values": obs["x"]}
    oy = {"start": obs["start"], "step": obs["step"], "values": obs["y"]}
    oz = {"start": obs["start"], "step": obs["step"], "values": obs["z"]}
    lo, hi = _common_range(refl, illum, ox)
    if not hi > lo:
        raise ValueError("光谱没有公共波长区间，无法计算")
    start = math.ceil(lo / step) * step
    count = int(math.floor((hi - start) / step)) + 1
    if count < 2:
        raise ValueError(f"公共区间过窄（{lo}–{hi}nm），无法计算")
    X = Y = Z = kd = 0.0
    for k in range(count):
        nm = start + k * step
        s = interp_at(illum, nm)
        r = interp_at(refl, nm)
        xb = interp_at(ox, nm)
        yb = interp_at(oy, nm)
        zb = interp_at(oz, nm)
        if s is None or r is None or xb is None:
            continue
        X += s * r * xb * step
        Y += s * r * yb * step
        Z += s * r * zb * step
        kd += s * yb * step
    k = 100.0 / kd
    rng = {"lo": start, "hi": start + (count - 1) * step, "step": step, "count": count}
    return [X * k, Y * k, Z * k], rng


def white_point(illum, observer="2deg", refl=None):
    grid = refl if refl is not None else illum
    ones = {"start": grid["start"], "step": grid["step"],
            "values": [1.0] * len(grid["values"])}
    xyz, _ = sd_to_xyz(ones, illum, observer)
    return xyz


# ---------------- XYZ / Lab / LCh ----------------

def _cbrt(x):
    return math.copysign(abs(x) ** (1.0 / 3.0), x)


def xyz_to_lab(xyz, wp):
    e, kappa = 216.0 / 24389.0, 24389.0 / 27.0

    def f(t):
        return _cbrt(t) if t > e else (kappa * t + 16.0) / 116.0

    fx, fy, fz = f(xyz[0] / wp[0]), f(xyz[1] / wp[1]), f(xyz[2] / wp[2])
    return [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]


def lab_to_xyz(lab, wp):
    e = 216.0 / 24389.0
    fy = (lab[0] + 16.0) / 116.0
    fx, fz = fy + lab[1] / 500.0, fy - lab[2] / 200.0

    def inv(t):
        t3 = t * t * t
        return t3 if t3 > e else (116.0 * t - 16.0) / (24389.0 / 27.0)

    return [wp[0] * inv(fx), wp[1] * inv(fy), wp[2] * inv(fz)]


def lab_to_lch(lab):
    c = math.hypot(lab[1], lab[2])
    h = math.degrees(math.atan2(lab[2], lab[1]))
    if h < 0:
        h += 360.0
    return [lab[0], c, h]


# ---------------- RGB 色彩空间 ----------------

def _mul(m, v):
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]


def _encode(c, kind):
    if c <= 0.0:
        return c
    if kind == "sRGB":
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1.0 / 2.4) - 0.055
    if kind == "bt2020":
        return 4.5 * c if c < 0.018 else 1.099 * c ** 0.45 - 0.099
    return c ** (256.0 / 563.0)  # Adobe RGB 纯 gamma 2.19921875


def _decode(c, kind):
    if c <= 0.0:
        return c
    if kind == "sRGB":
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    if kind == "bt2020":
        return c / 4.5 if c < 4.5 * 0.018 else ((c + 0.099) / 1.099) ** (1.0 / 0.45)
    return c ** (563.0 / 256.0)


def xyz_to_rgb(xyz, space="sRGB"):
    s = DATA["spaces"][space]
    lin = _mul(s["xyz_to_rgb"], [q / 100.0 for q in xyz])
    return [_encode(c, s["transfer"]) for c in lin]


def rgb_to_xyz(rgb, space="sRGB"):
    s = DATA["spaces"][space]
    lin = [_decode(c, s["transfer"]) for c in rgb]
    return [q * 100.0 for q in _mul(s["rgb_to_xyz"], lin)]


def gamut(rgb):
    eps = 1e-6
    inside = all(-eps <= c <= 1.0 + eps for c in rgb)
    clipped = [min(1.0, max(0.0, c)) for c in rgb]
    return {"inside": inside, "clipped": clipped, "raw": list(rgb)}


def rgb_to_hex(rgb01):
    return "#" + "".join("%02x" % round(min(1.0, max(0.0, c)) * 255) for c in rgb01)


# ---------------- 色适应 ----------------

def adapt_xyz(xyz, src_wp, dst_wp):
    """Bradford 色适应：把 XYZ 从 src_wp 白点映射到 dst_wp 白点。"""
    def n(wp):
        return [wp[0] / wp[1], 1.0, wp[2] / wp[1]]

    s = _mul(BRADFORD, n(src_wp))
    d = _mul(BRADFORD, n(dst_wp))
    cone = _mul(BRADFORD, xyz)
    scaled = [cone[0] * d[0] / s[0], cone[1] * d[1] / s[1], cone[2] * d[2] / s[2]]
    return _mul(BRADFORD_INV, scaled)


# ---------------- 色差 ----------------

def delta_e76(lab1, lab2):
    return math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2])


def delta_e00(lab1, lab2, kL=1.0, kC=1.0, kH=1.0):
    """CIEDE2000（Sharma et al. 实现）"""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    cbar = (c1 + c2) / 2.0
    c7 = cbar ** 7
    g = 0.5 * (1.0 - math.sqrt(c7 / (c7 + 25.0 ** 7)))
    a1p, a2p = (1.0 + g) * a1, (1.0 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)

    def hue(b, a):
        if b == 0 and a == 0:
            return 0.0
        return (math.degrees(math.atan2(b, a)) + 360.0) % 360.0

    h1p, h2p = hue(b1, a1p), hue(b2, a2p)
    dlp = l2 - l1
    dcp = c2p - c1p
    dhp = 0.0
    if c1p * c2p != 0.0:
        dhp = h2p - h1p
        if dhp > 180.0:
            dhp -= 360.0
        elif dhp < -180.0:
            dhp += 360.0
    dhp = 2.0 * math.sqrt(c1p * c2p) * math.sin(dhp * D2R / 2.0)
    lbp = (l1 + l2) / 2.0
    cbp = (c1p + c2p) / 2.0
    if c1p * c2p == 0.0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        hbp = (h1p + h2p) / 2.0
    elif h1p + h2p < 360.0:
        hbp = (h1p + h2p + 360.0) / 2.0
    else:
        hbp = (h1p + h2p - 360.0) / 2.0
    t = (1.0
         - 0.17 * math.cos((hbp - 30.0) * D2R)
         + 0.24 * math.cos(2.0 * hbp * D2R)
         + 0.32 * math.cos((3.0 * hbp + 6.0) * D2R)
         - 0.20 * math.cos((4.0 * hbp - 63.0) * D2R))
    dtheta = 30.0 * math.exp(-((hbp - 275.0) / 25.0) ** 2)
    cbp7 = cbp ** 7
    rc = 2.0 * math.sqrt(cbp7 / (cbp7 + 25.0 ** 7))
    sl = 1.0 + (0.015 * (lbp - 50.0) ** 2) / math.sqrt(20.0 + (lbp - 50.0) ** 2)
    sc = 1.0 + 0.045 * cbp
    sh = 1.0 + 0.015 * cbp * t
    rt = -math.sin(2.0 * dtheta * D2R) * rc
    tl = dlp / (kL * sl)
    tc = dcp / (kC * sc)
    th = dhp / (kH * sh)
    return math.sqrt(tl * tl + tc * tc + th * th + rt * tc * th)


delta_e2000 = delta_e00  # 别名


# ---------------- 便捷入口 ----------------

def compute(refl, illum, observer="2deg", adapt=True, spaces=None):
    """低层：refl/illum 都应是 {"start","step","values"} 字典。"""
    obs_key = observer if observer in DATA["cmfs"] else "2deg"
    xyz, rng = sd_to_xyz(refl, illum, obs_key)
    wp = white_point(illum, obs_key, refl)
    lab = xyz_to_lab(xyz, wp)
    out = {
        "XYZ": xyz, "Lab": lab, "LCh": lab_to_lch(lab),
        "white_point": wp, "range": rng, "adapted": bool(adapt), "rgb": {},
    }
    for name in spaces or SPACE_ORDER:
        dst_wp = DATA["spaces"][name]["whitepoint"]
        X = adapt_xyz(xyz, wp, dst_wp) if adapt else xyz
        rgb = xyz_to_rgb(X, name)
        g = gamut(rgb)
        out["rgb"][name] = {
            "rgb": rgb, "inside": g["inside"], "clipped": g["clipped"],
            "raw": g["raw"], "hex": rgb_to_hex(g["clipped"]),
        }
    return out


def simulate(refl, illum, observer="2deg", adapt=True, spaces=None):
    """反射率 × 光源 → 颜色。

    参数
      refl     反射率（0~1）。dict{start,step,values} / (start,step,values) / [(波长,值),…]
      illum    光源：内置名（'D65'、'A'、'FL2'…）或任意 SD（同上三种形式）
      observer '2deg'（CIE 1931 2°）或 '10deg'（CIE 1964 10°）
      adapt    是否先做 Bradford 色适应到显示空间白点（默认 True）
      spaces   要算的 RGB 空间列表，默认全部四个

    返回 dict：XYZ / Lab / LCh / white_point / range / adapted / rgb{space:{rgb,hex,inside,clipped}}
    """
    return compute(coerce_sd(refl, "反射率"), illuminate(illum), observer, adapt, spaces)


def delta_e(lab1, lab2, method="CIE2000"):
    """method: 'CIE2000'（默认）| 'CIE76'"""
    return delta_e00(lab1, lab2) if method.upper() in ("CIE2000", "DE2000", "00") else delta_e76(lab1, lab2)
