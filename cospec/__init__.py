"""cospec — 光谱颜色模拟 Python SDK（纯 Python，零第三方依赖）。

用法：

    import cospec

    r = cospec.simulate(
        refl=[(380, 0.18), (390, 0.18), ...],   # 反射率（0~1）
        illum="D65",                             # 光源：内置名或自定义光谱
        observer="2deg",                         # 观察者：2deg / 10deg
        adapt=True,                              # 是否做 Bradford 色适应
    )
    r["XYZ"]   # [X, Y, Z]
    r["Lab"]   # [L*, a*, b*]
    r["rgb"]["sRGB"]["hex"]   # 各空间：sRGB / Display P3 / Adobe RGB (1998) / ITU-R BT.2020

    d = cospec.delta_e00(lab1, lab2)   # CIEDE2000 色差
"""
from .colorimetry import (
    SPACE_ORDER,
    ILLUMINANTS,
    coerce_sd,
    illuminate,
    sd_to_xyz,
    white_point,
    xyz_to_lab,
    lab_to_xyz,
    lab_to_lch,
    xyz_to_rgb,
    rgb_to_xyz,
    gamut,
    rgb_to_hex,
    adapt_xyz,
    delta_e76,
    delta_e00,
    delta_e2000,
    delta_e,
    compute,
    simulate,
)

__all__ = [
    "SPACE_ORDER", "ILLUMINANTS",
    "coerce_sd", "illuminate", "sd_to_xyz", "white_point",
    "xyz_to_lab", "lab_to_xyz", "lab_to_lch",
    "xyz_to_rgb", "rgb_to_xyz", "gamut", "rgb_to_hex", "adapt_xyz",
    "delta_e76", "delta_e00", "delta_e2000", "delta_e",
    "compute", "simulate",
]

__version__ = "0.1.0"
