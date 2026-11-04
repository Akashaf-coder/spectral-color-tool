#!/usr/bin/env python3
"""cospec SDK 与 colour-science 的数值一致性测试（纯 stdlib）。

    python3 test/sdk_parity.py

与 test/parity.mjs 用同一份 test/reference.json，保证
Python SDK == 网页 colorimetry.js == colour-science。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from cospec import (  # noqa: E402
    compute, illuminate, white_point, delta_e76, delta_e00,
)

ref = json.load(open(os.path.join(ROOT, "test", "reference.json"), encoding="utf-8"))

TOL = {"XYZ": 0.02, "Lab": 0.05, "RGB": 0.002, "RGBa": 0.01, "dE": 0.01, "white": 0.02}
worst = dict.fromkeys(TOL, 0.0)
fails = []


def rec(kind, v, label):
    global worst
    if not (v == v) or v in (float("inf"), float("-inf")):  # 非有限值
        fails.append(f"{kind} 出现非有限值 @ {label}")
        return
    v = abs(v)
    if v > worst[kind]:
        worst[kind] = v
    if v > TOL[kind]:
        fails.append(f"{kind} 偏差 {v:.3e} 超过阈值 {TOL[kind]} @ {label}")


SPACES = ["sRGB", "Display P3", "Adobe RGB (1998)", "ITU-R BT.2020"]

# 1) 白点（与参考同网格 380–780nm @1nm）
ones = {"start": 380, "step": 1, "values": [1.0] * 401}
for ill, per_obs in ref["whites"].items():
    for obs, xyz in per_obs.items():
        mine = white_point(illuminate(ill), obs, ones)
        for i, v in enumerate(mine):
            rec("white", v - xyz[i], f"white {ill}/{obs}[{i}]")

# 2) 各算例：XYZ / Lab / RGB（色适应开/关）
for c in ref["cases"]:
    tag = f"{c['curve']}/{c['illuminant']}/{c['observer']}"
    r = compute(c["refl"], illuminate(c["illuminant"]), c["observer"], adapt=False, spaces=SPACES)
    ra = compute(c["refl"], illuminate(c["illuminant"]), c["observer"], adapt=True, spaces=SPACES)
    for i, v in enumerate(r["XYZ"]):
        rec("XYZ", v - c["XYZ"][i], f"{tag} XYZ[{i}]")
    for i, v in enumerate(r["Lab"]):
        rec("Lab", v - c["Lab"][i], f"{tag} Lab[{i}]")
    for sp, rgb in c["rgb"].items():
        for i, v in enumerate(r["rgb"][sp]["rgb"]):
            rec("RGB", v - rgb[i], f"{tag} {sp}[{i}]")
    for sp, rgb in c["rgbAdapted"].items():
        for i, v in enumerate(ra["rgb"][sp]["rgb"]):
            rec("RGBa", v - rgb[i], f"{tag} 适应后 {sp}[{i}]")

# 3) 色差
for p in ref["pairs"]:
    tag = f"dE {p['curve']}/{p['illuminant']}/{p['observer']}"
    rec("dE", delta_e76(p["lab1"], p["lab2"]) - p["dE76"], f"{tag} 76")
    rec("dE", delta_e00(p["lab1"], p["lab2"]) - p["dE2000"], f"{tag} 2000")

print("与 colour-science 的最大偏差（Python SDK）：")
for k in ["XYZ", "Lab", "RGB", "RGBa", "dE", "white"]:
    print(f"  {k:5s} {worst[k]:.3e}   (阈值 {TOL[k]})")
print(f"  算例 {len(ref['cases'])} 个 / 色差对 {len(ref['pairs'])} 个")

if fails:
    print(f"\n失败 {len(fails)} 项：")
    for f in fails[:20]:
        print("  " + f)
    sys.exit(1)
print("\nPASS")
