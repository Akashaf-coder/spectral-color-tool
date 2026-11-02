/* colorimetry.js — 色度学计算核心（零依赖）
 *
 * 术语约定
 *   光谱分布 SD：{start, step, values[]}，波长单位 nm，values 与波长等长
 *   反射率：0~1（导入时统一归一化）
 *   光源 SPD：相对值（D65 在 560nm 处为 100），只关心相对形状
 *   观察者：'2deg' = CIE 1931 2°，'10deg' = CIE 1964 10°
 *   XYZ：0~100 相对色度，Y 归一化到 100（完美漫反射白 = 100）
 *
 * 计算口径（与 colour-science 对齐，已做数值比对）
 *   k  = 100 / Σ S(λ)·ȳ(λ)·Δλ
 *   XYZ = k · Σ S(λ)·R(λ)·x̄(λ)·Δλ
 */
(function (global) {
  "use strict";

  const CORE = global.COSPEC_CORE;
  const D2R = Math.PI / 180;

  /* ---------- 光谱工具 ---------- */

  function sdEnd(sd) {
    return sd.start + sd.step * (sd.values.length - 1);
  }

  /** 线性插值取某波长的值；超出范围返回 null（不外推） */
  function interpAt(sd, nm) {
    const i = (nm - sd.start) / sd.step;
    if (i < -1e-9 || i > sd.values.length - 1 + 1e-9) return null;
    const i0 = Math.floor(i);
    if (i0 >= sd.values.length - 1) return sd.values[sd.values.length - 1];
    const f = i - i0;
    return sd.values[i0] * (1 - f) + sd.values[i0 + 1] * f;
  }

  /** 重采样到新的网格（线性插值，只覆盖两者交集） */
  function resample(sd, start, step, count) {
    const out = new Array(count);
    for (let k = 0; k < count; k++) out[k] = interpAt(sd, start + step * k);
    return { start, step, values: out };
  }

  /** 两个/多个 SD 的公共波长区间 */
  function commonRange(sds) {
    const lo = Math.max(...sds.map((s) => s.start));
    const hi = Math.min(...sds.map(sdEnd));
    return { lo, hi };
  }

  /* ---------- 内置数据 ---------- */

  function illuminant(name) {
    const raw = CORE.illuminants[name];
    if (!raw) throw new Error("未知光源: " + name);
    return { start: raw.start, step: raw.step, values: raw.values };
  }

  function observer(key) {
    const c = CORE.cmfs[key];
    if (!c) throw new Error("未知观察者: " + key);
    return {
      key,
      label: c.label,
      start: c.start,
      step: c.step,
      x: { start: c.start, step: c.step, values: c.x },
      y: { start: c.start, step: c.step, values: c.y },
      z: { start: c.start, step: c.step, values: c.z },
    };
  }

  /* ---------- 主计算：反射率 + 光源 → XYZ ---------- */

  /**
   * @param {object} refl     反射率 SD（0~1）
   * @param {object} illum    光源 SD
   * @param {string} obsKey   '2deg' | '10deg'
   * @returns {{XYZ:number[], range:{lo:number,hi:number,step:number}, k:number}}
   */
  function sdToXYZ(refl, illum, obsKey, step) {
    step = step || 1;
    const obs = observer(obsKey);
    const { lo, hi } = commonRange([refl, illum, obs.x]);
    if (!(hi > lo)) throw new Error("光谱没有公共波长区间，无法计算");
    const start = Math.ceil(lo / step) * step;
    const count = Math.floor((hi - start) / step) + 1;
    if (count < 2) throw new Error("公共区间过窄（" + lo + "–" + hi + "nm），无法计算");

    let X = 0, Y = 0, Z = 0, kd = 0;
    for (let k = 0; k < count; k++) {
      const nm = start + k * step;
      const s = interpAt(illum, nm);
      const r = interpAt(refl, nm);
      const xb = interpAt(obs.x, nm);
      const yb = interpAt(obs.y, nm);
      const zb = interpAt(obs.z, nm);
      if (s === null || r === null || xb === null) continue;
      X += s * r * xb * step;
      Y += s * r * yb * step;
      Z += s * r * zb * step;
      kd += s * yb * step;
    }
    const k = 100 / kd;
    return {
      XYZ: [X * k, Y * k, Z * k],
      range: { lo: start, hi: start + (count - 1) * step, step, count },
      k,
    };
  }

  /**
   * 某光源下的白点（完美漫反射体 R=1 的 XYZ），作为 Lab 参考白。
   * 传入 reflSd 时用它的波长网格积分，保证与样品同网格（Lab 才有意义）。
   */
  function whitePoint(illum, obsKey, reflSd) {
    const grid = reflSd || { start: illum.start, step: illum.step, values: illum.values };
    const ones = { start: grid.start, step: grid.step, values: new Array(grid.values.length).fill(1) };
    return sdToXYZ(ones, illum, obsKey).XYZ;
  }

  /* ---------- XYZ / Lab / LCh ---------- */

  function xyzToLab(XYZ, wp) {
    const e = 216 / 24389, kappa = 24389 / 27;
    const f = (t) => (t > e ? Math.cbrt(t) : (kappa * t + 16) / 116);
    const fx = f(XYZ[0] / wp[0]), fy = f(XYZ[1] / wp[1]), fz = f(XYZ[2] / wp[2]);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToXyz(lab, wp) {
    const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    const inv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
    return [wp[0] * inv(fx), wp[1] * inv(fy), wp[2] * inv(fz)];
  }

  function labToLch(lab) {
    const C = Math.hypot(lab[1], lab[2]);
    let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
    if (h < 0) h += 360;
    return [lab[0], C, h];
  }

  /* ---------- RGB 色彩空间 ---------- */

  function space(name) {
    const s = CORE.spaces[name];
    if (!s) throw new Error("未知色彩空间: " + name);
    return s;
  }

  function encode(c, kind) {
    if (c <= 0) return c; // 负值原样保留，交给色域判断
    if (kind === "sRGB") return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.pow(c, 256 / 563); // Adobe RGB (1998) 纯 gamma 2.19921875
  }

  function decode(c, kind) {
    if (c <= 0) return c;
    if (kind === "sRGB") return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return Math.pow(c, 563 / 256);
  }

  function mul(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ];
  }

  /** XYZ(0~100) → 编码后的 RGB(0~1)，不裁剪 */
  function xyzToRgb(XYZ, spaceName) {
    const s = space(spaceName);
    const lin = mul(s.xyz_to_rgb, XYZ.map((q) => q / 100));
    return lin.map((c) => encode(c, s.transfer));
  }

  /** 编码后的 RGB(0~1) → XYZ(0~100)，不裁剪 */
  function rgbToXyz(rgb, spaceName) {
    const s = space(spaceName);
    const lin = rgb.map((c) => decode(c, s.transfer));
    return mul(s.rgb_to_xyz, lin).map((q) => q * 100);
  }

  /** 色域判断：返回 {inside, clipped} 以及裁剪后的 0~1 值 */
  function gamut(rgb01) {
    const eps = 1e-6;
    const inside = rgb01.every((c) => c >= -eps && c <= 1 + eps);
    const clipped = rgb01.map((c) => Math.min(1, Math.max(0, c)));
    return { inside, clipped, raw: rgb01.slice() };
  }

  function rgbToHex(rgb01) {
    const h = rgb01.map((c) => {
      const v = Math.round(Math.min(1, Math.max(0, c)) * 255);
      return v.toString(16).padStart(2, "0");
    });
    return "#" + h.join("");
  }

  /* ---------- 色差 ---------- */

  function deltaE76(lab1, lab2) {
    return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
  }

  function deltaE2000(lab1, lab2, kL, kC, kH) {
    kL = kL || 1; kC = kC || 1; kH = kH || 1;
    const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const C7 = Math.pow(Cbar, 7), G = 0.5 * (1 - Math.sqrt(C7 / (C7 + Math.pow(25, 7))));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hue = (b, a) => {
      if (b === 0 && a === 0) return 0;
      const h = (Math.atan2(b, a) / D2R + 360) % 360;
      return h;
    };
    const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * D2R) / 2);
    const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;
    const T = 1
      - 0.17 * Math.cos((hbp - 30) * D2R)
      + 0.24 * Math.cos(2 * hbp * D2R)
      + 0.32 * Math.cos((3 * hbp + 6) * D2R)
      - 0.20 * Math.cos((4 * hbp - 63) * D2R);
    const dtheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const SC = 1 + 0.045 * Cbp;
    const SH = 1 + 0.015 * Cbp * T;
    const RT = -Math.sin(2 * dtheta * D2R) * RC;
    const tL = dLp / (kL * SL), tC = dCp / (kC * SC), tH = dHp / (kH * SH);
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  /* ---------- 色适应（Bradford）---------- */

  const BRADFORD = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
  ];
  const BRADFORD_INV = [
    [0.9869929, -0.1470543, 0.1599627],
    [0.4323053, 0.5183603, 0.0492912],
    [-0.0085287, 0.0400428, 0.9684867],
  ];

  /**
   * 把 XYZ 从 srcWP 白点适应到 dstWP 白点（Bradford / 冯·克里斯）。
   * 关掉它，非 D65 光源下的 RGB 就会爆掉——那是"未白平衡"的视图，不是人眼所见。
   */
  function adaptXYZ(XYZ, srcWP, dstWP) {
    if (!srcWP || srcWP.length !== 3 || !dstWP || dstWP.length !== 3) {
      throw new Error("色适应需要 XYZ 白点（3 个分量），收到的是 " + JSON.stringify(srcWP) + " → " + JSON.stringify(dstWP));
    }
    // 白点各自归一到 Y=1，避免 0~100 与 0~1 混用
    const n = (wp) => [wp[0] / wp[1], 1, wp[2] / wp[1]];
    const s = mul(BRADFORD, n(srcWP));
    const d = mul(BRADFORD, n(dstWP));
    const cone = mul(BRADFORD, XYZ);
    const scaled = [cone[0] * (d[0] / s[0]), cone[1] * (d[1] / s[1]), cone[2] * (d[2] / s[2])];
    return mul(BRADFORD_INV, scaled);
  }

  /* ---------- 便捷封装：一条反射率 → 完整结果 ---------- */

  /**
   * @param {object} o
   *   refl    反射率 SD（0~1）
   *   illum   光源 SD 或内置光源名
   *   observerKey '2deg'|'10deg'
   *   spaces   要计算的色彩空间名数组
   *   adapt    是否先做色适应（把光源白点适应到显示空间白点），默认 true
   */
  function compute(o) {
    const illum = typeof o.illum === "string" ? illuminant(o.illum) : o.illum;
    const obsKey = o.observerKey || "2deg";
    const adapt = o.adapt !== false;
    const res = sdToXYZ(o.refl, illum, obsKey);
    const wp = whitePoint(illum, obsKey, o.refl);
    const Lab = xyzToLab(res.XYZ, wp);
    const out = {
      XYZ: res.XYZ, Lab, LCh: labToLch(Lab), whitePoint: wp, range: res.range,
      adapted: adapt, rgb: {},
    };
    (o.spaces || CORE.space_order).forEach((name) => {
      const dstWP = space(name).whitepoint;
      const XYZ = adapt ? adaptXYZ(res.XYZ, wp, dstWP) : res.XYZ;
      const rgb = xyzToRgb(XYZ, name);
      out.rgb[name] = { rgb, ...gamut(rgb), hex: rgbToHex(gamut(rgb).clipped) };
    });
    return out;
  }

  global.COSPEC = global.COSPEC || {};
  global.COSPEC.color = {
    interpAt, resample, commonRange, sdEnd,
    illuminant, observer, whitePoint,
    sdToXYZ, xyzToLab, labToXyz, labToLch,
    xyzToRgb, rgbToXyz, gamut, rgbToHex, adaptXYZ,
    deltaE76, deltaE2000, compute,
    SPACES: CORE.space_order,
  };
})(typeof window !== "undefined" ? window : globalThis);
