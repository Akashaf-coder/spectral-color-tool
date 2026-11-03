#!/usr/bin/env python3
"""由 colour-science 生成 core.js（CIE 数据快照）。

运行时不需要 Python，也不联网：这个脚本只是"重新生成数据快照"的开发工具。
    ./.venv/bin/python tools/gen_core.py

依赖 colour-science 0.4.x。数据来源为 CIE 官方推荐值，经 colour 库整理。
"""
import json
import os
import sys

import colour

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core.js")

# 观察者：CIE 1931 2° 与 CIE 1964 10°，1nm 网格 360–830nm
CMF_KEYS = [
    ("CIE 1931 2 Degree Standard Observer", "2deg"),
    ("CIE 1964 10 Degree Standard Observer", "10deg"),
]
CMF_START, CMF_END, CMF_STEP = 360, 830, 1

# 光源：colour 自带的全部 CIE 标准光源（A/B/C/D 系列/FL/LED/HP 等），5nm 300–780nm
ILL_START, ILL_END, ILL_STEP = 300, 780, 5

# 色彩空间
SPACES = ["sRGB", "Display P3", "Adobe RGB (1998)", "ITU-R BT.2020"]

# 传递函数类型（colorimetry.js 里按这个 key 走对应公式）
TRANSFER = {
    "sRGB": "sRGB",
    "Display P3": "sRGB",
    "Adobe RGB (1998)": "g2.19921875",
    "ITU-R BT.2020": "bt2020",  # OETF：α=1.099, β=0.018
}


def resample(sd, start, end, step):
    d = sd.copy()
    d.interpolate(colour.SpectralShape(start, end, step))
    return d


def main():
    core = {"generator": f"colour-science {colour.__version__}"}

    cmfs = {}
    for key, label in CMF_KEYS:
        sd = resample(colour.MSDS_CMFS[key], CMF_START, CMF_END, CMF_STEP)
        cmfs[label] = {
            "label": "CIE 1931 2° 标准观察者" if label == "2deg" else "CIE 1964 10° 标准观察者",
            "start": CMF_START,
            "step": CMF_STEP,
            "x": [round(float(v[0]), 7) for v in sd.values],
            "y": [round(float(v[1]), 7) for v in sd.values],
            "z": [round(float(v[2]), 7) for v in sd.values],
        }
    core["cmfs"] = cmfs
    core["cmf_keys"] = [label for _, label in CMF_KEYS]

    ill = {}
    for name, sd in colour.SDS_ILLUMINANTS.items():
        # 只取原生范围与目标区间的交集，然后按实际结果的起始波长记账
        native_start = float(sd.wavelengths[0])
        native_end = float(sd.wavelengths[-1])
        start = max(ILL_START, native_start)
        end = min(ILL_END, native_end)
        d = resample(sd, start, end, ILL_STEP)
        actual_start = float(d.wavelengths[0])
        actual_step = float(d.wavelengths[1] - d.wavelengths[0])
        ill[name] = {
            "start": actual_start,
            "step": actual_step,
            "values": [round(float(v), 4) for v in d.values],
        }
    core["illuminants"] = ill
    core["illuminant_groups"] = {
        "标准光源": ["A", "C", "D50", "D55", "D65", "D75", "E"],
        "荧光灯 FL": ["FL1", "FL2", "FL3", "FL4", "FL5", "FL6", "FL7", "FL8",
                      "FL9", "FL10", "FL11", "FL12"],
        "LED": sorted(k for k in ill if k.startswith("LED")),
        "高压放电灯 HP": sorted(k for k in ill if k.startswith("HP")),
    }

    spaces = {}
    for n in SPACES:
        cs = colour.RGB_COLOURSPACES[n]
        spaces[n] = {
            "rgb_to_xyz": [[round(float(v), 8) for v in row] for row in cs.matrix_RGB_to_XYZ],
            "xyz_to_rgb": [[round(float(v), 8) for v in row] for row in cs.matrix_XYZ_to_RGB],
            # colour 的 whitepoint 是 xy 色度，这里存成 XYZ（Y=1），便于做色适应
            "whitepoint_xy": [round(float(v), 6) for v in cs.whitepoint],
            "whitepoint": [round(float(v), 6) for v in colour.xy_to_XYZ(cs.whitepoint)],
            "transfer": TRANSFER[n],
            "whitepoint_name": cs.whitepoint_name,
        }
    core["spaces"] = spaces
    core["space_order"] = SPACES

    payload = json.dumps(core, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("/* 由 tools/gen_core.py 生成，勿手改。数据：colour-science "
                 f"{colour.__version__} / CIE 官方推荐值 */\n")
        fh.write("window.COSPEC_CORE=" + payload + ";\n")

    size = os.path.getsize(OUT)
    print(f"写入 {OUT}  {size/1024:.1f} KB")
    print(f"  观察者 {len(core['cmfs'])}（各 {len(cmfs['2deg']['x'])} 点 @1nm）")
    print(f"  光源   {len(ill)}")
    print(f"  空间   {', '.join(spaces)}")


if __name__ == "__main__":
    sys.exit(main())
