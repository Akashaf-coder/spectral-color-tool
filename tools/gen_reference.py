#!/usr/bin/env python3
"""生成 test/reference.json：用 colour-science 算出的参考值，供 test/parity.mjs 比对。

    ./.venv/bin/python tools/gen_reference.py

约定：XYZ 不做色适应（与 colorimetry.js 的实现口径一致），RGB 直接走矩阵+传递函数。
"""
import json
import os

import colour
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "test", "reference.json")

CMFS = {
    "2deg": colour.MSDS_CMFS["CIE 1931 2 Degree Standard Observer"],
    "10deg": colour.MSDS_CMFS["CIE 1964 10 Degree Standard Observer"],
}
SPACES = ["sRGB", "Display P3", "Adobe RGB (1998)"]


def sd(start, step, values):
    wl = np.arange(start, start + step * len(values), step)
    return colour.SpectralDistribution(dict(zip(wl, values)), name="s")


def encode_rgb(lin, space_name):
    """把线性 RGB 编码成 0~1 显示值。

    约定：线性值 <= 0 时原样保留（不产生 NaN），色域判断交给调用方。
    colour 的 cctf 在负值上会给出 NaN，这里显式绕开，其余与 colour 完全一致。
    """
    lin = np.asarray(lin, dtype=float)
    if space_name in ("sRGB", "Display P3"):
        safe = np.maximum(lin, 0.0)
        enc = np.where(safe <= 0.0031308, 12.92 * safe, 1.055 * safe ** (1 / 2.4) - 0.055)
    else:  # Adobe RGB (1998)：纯 gamma 2.19921875
        enc = np.power(np.maximum(lin, 0.0), 256 / 563)
    return np.where(lin <= 0, lin, enc)


def refl_curves():
    """人造反射率曲线，覆盖平坦/倾斜/窄带/极暗/极亮"""
    out = {}
    wl = np.arange(380, 731, 10)
    out["flat18"] = sd(380, 10, [0.18] * wl.size)

    wl = np.arange(400, 701, 5)
    out["paper"] = sd(400, 5, [0.78 + 0.12 * np.sin((w - 400) / 300 * np.pi) for w in wl])
    out["orange"] = sd(400, 5, [max(0.0, 0.05 + 0.9 * ((w - 400) / 300) ** 2) for w in wl])
    out["black"] = sd(400, 5, [0.03] * wl.size)

    wl = np.arange(400, 701, 1)
    out["narrow"] = sd(400, 1, [0.02 + 0.75 * np.exp(-((w - 550) / 12) ** 2) for w in wl])
    out["teal"] = sd(400, 1, [max(0.0, 0.85 - 2.4 * abs(w - 480) / 100) for w in wl])
    return out


CMF_START, CMF_END = 360, 830


def align_1nm(refl, ill, cmf_key):
    """把反射率 / 光源 / 观察者统一重采样到 1nm 的公共区间。

    与 colorimetry.js 的口径完全一致：交集区间 + 线性插值 + 矩形法积分。
    """
    lo = max(float(refl.wavelengths[0]), float(ill.wavelengths[0]), float(CMF_START))
    hi = min(float(refl.wavelengths[-1]), float(ill.wavelengths[-1]), float(CMF_END))
    shape = colour.SpectralShape(lo, hi, 1)
    r = refl.copy(); r.interpolate(shape)
    i = ill.copy(); i.interpolate(shape)
    c = CMFS[cmf_key].copy(); c.interpolate(shape)
    return r, i, c


def main():
    curves = refl_curves()
    ill_names = ["D65", "A", "D50", "FL2", "LED-B3", "D75", "E"]
    obs_keys = ["2deg", "10deg"]

    cases = []
    for cname, refl in curves.items():
        for ill_name in ill_names:
            ill = colour.SDS_ILLUMINANTS[ill_name]
            for obs in obs_keys:
                r1, i1, c1 = align_1nm(refl, ill, obs)
                XYZ = colour.sd_to_XYZ(r1, c1, i1, method="Integration").tolist()
                target = np.asarray(XYZ) / 100
                white_sd = colour.SpectralDistribution(
                    dict(zip(refl.wavelengths, np.ones(len(refl.values)))), name="w")
                w1, _, _ = align_1nm(white_sd, ill, obs)
                white = colour.sd_to_XYZ(w1, c1, i1, method="Integration")
                Lab = colour.XYZ_to_Lab(target, colour.XYZ_to_xy(np.asarray(white))).tolist()
                rgb, rgb_adapted = {}, {}
                wp_xy = colour.XYZ_to_xy(np.asarray(white))
                for sp in SPACES:
                    cs = colour.RGB_COLOURSPACES[sp]
                    rgb[sp] = encode_rgb(
                        colour.XYZ_to_RGB(target, cs, illuminant=None,
                                          apply_cctf_encoding=False), sp).tolist()
                    rgb_adapted[sp] = encode_rgb(
                        colour.XYZ_to_RGB(target, cs, illuminant=wp_xy,
                                          chromatic_adaptation_transform="Bradford",
                                          apply_cctf_encoding=False), sp).tolist()
                cases.append({
                    "curve": cname, "illuminant": ill_name, "observer": obs,
                    "refl": {"start": float(refl.wavelengths[0]),
                             "step": float(refl.wavelengths[1] - refl.wavelengths[0]),
                             "values": [round(float(v), 6) for v in refl.values]},
                    "XYZ": XYZ, "Lab": Lab, "white": list(map(float, white)),
                    "rgb": rgb, "rgbAdapted": rgb_adapted,
                })

    # ΔE 参考对：同一曲线在不同光源下的 Lab 差
    pairs = []
    for cname in curves:
        for ill_name in ["D65", "A"]:
            for obs in obs_keys:
                cs = [c for c in cases if c["curve"] == cname and c["observer"] == obs]
                lab_a = next(c["Lab"] for c in cs if c["illuminant"] == "D65")
                lab_b = next(c["Lab"] for c in cs if c["illuminant"] == ill_name)
                d76 = float(colour.delta_E(np.array(lab_a), np.array(lab_b), method="CIE 1976"))
                d00 = float(colour.delta_E(np.array(lab_a), np.array(lab_b), method="CIE 2000"))
                pairs.append({"curve": cname, "observer": obs, "illuminant": ill_name,
                              "lab1": lab_a, "lab2": lab_b, "dE76": d76, "dE2000": d00})

    # 白点（完美漫反射体，与算例同网格）
    whites = {}
    for ill_name in ill_names:
        whites[ill_name] = {}
        for obs in obs_keys:
            refl1 = colour.SpectralDistribution(
                dict(zip(np.arange(380, 781, 1), np.ones(401))), name="w")
            r1, i1, c1 = align_1nm(refl1, colour.SDS_ILLUMINANTS[ill_name], obs)
            whites[ill_name][obs] = colour.sd_to_XYZ(
                r1, c1, i1, method="Integration").tolist()

    data = {"cases": cases, "pairs": pairs, "whites": whites}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, allow_nan=False)
    print(f"写入 {OUT}: {len(cases)} 个算例, {len(pairs)} 个色差对, "
          f"{len(whites)}×{len(obs_keys)} 个白点")


if __name__ == "__main__":
    main()
