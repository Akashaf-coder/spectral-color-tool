// test/parity.mjs — colorimetry.js 与 colour-science 的数值一致性测试
//   node test/parity.mjs
// 参考值由 tools/gen_reference.py 生成（test/reference.json）。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 在沙箱里把 core.js / colorimetry.js 当浏览器脚本执行
const sandbox = { console, Math, JSON };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["core.js", "colorimetry.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}
const C = sandbox.COSPEC.color;
const ref = JSON.parse(fs.readFileSync(path.join(root, "test", "reference.json"), "utf8"));

const TOL = { XYZ: 0.02, Lab: 0.05, RGB: 0.002, RGBa: 0.01, dE: 0.01, white: 0.02 };

let worst = { XYZ: 0, Lab: 0, RGB: 0, RGBa: 0, dE: 0, white: 0 };
const fails = [];
const rec = (kind, v, label) => {
  if (!Number.isFinite(v)) { fails.push(`${kind} 出现非有限值 @ ${label}`); return; }
  if (v > worst[kind]) worst[kind] = v;
  if (v > TOL[kind]) fails.push(`${kind} 偏差 ${v.toExponential(3)} 超过阈值 ${TOL[kind]} @ ${label}`);
};

// 1) 白点（与参考同网格：380–780nm @1nm）
const onesGrid = { start: 380, step: 1, values: new Array(401).fill(1) };
for (const [ill, perObs] of Object.entries(ref.whites)) {
  for (const [obs, xyz] of Object.entries(perObs)) {
    const mine = C.whitePoint(C.illuminant(ill), obs, onesGrid);
    mine.forEach((v, i) => rec("white", Math.abs(v - xyz[i]), `white ${ill}/${obs}[${i}]`));
  }
}

// 2) 各算例：XYZ / Lab / RGB（色适应开 / 关两套）
for (const c of ref.cases) {
  const base = {
    refl: c.refl,
    illum: c.illuminant,
    observerKey: c.observer,
    spaces: ["sRGB", "Display P3", "Adobe RGB (1998)", "ITU-R BT.2020"],
  };
  const r = C.compute({ ...base, adapt: false });
  const ra = C.compute({ ...base, adapt: true });
  const tag = `${c.curve}/${c.illuminant}/${c.observer}`;
  r.XYZ.forEach((v, i) => rec("XYZ", Math.abs(v - c.XYZ[i]), `${tag} XYZ[${i}]`));
  r.Lab.forEach((v, i) => rec("Lab", Math.abs(v - c.Lab[i]), `${tag} Lab[${i}]`));
  for (const [sp, rgb] of Object.entries(c.rgb)) {
    r.rgb[sp].rgb.forEach((v, i) => rec("RGB", Math.abs(v - rgb[i]), `${tag} ${sp}[${i}]`));
  }
  for (const [sp, rgb] of Object.entries(c.rgbAdapted)) {
    ra.rgb[sp].rgb.forEach((v, i) => rec("RGBa", Math.abs(v - rgb[i]), `${tag} 适应后 ${sp}[${i}]`));
  }
}

// 3) 色差
for (const p of ref.pairs) {
  const tag = `dE ${p.curve}/${p.illuminant}/${p.observer}`;
  rec("dE", Math.abs(C.deltaE76(p.lab1, p.lab2) - p.dE76), `${tag} 76`);
  rec("dE", Math.abs(C.deltaE2000(p.lab1, p.lab2) - p.dE2000), `${tag} 2000`);
}

const pct = (v) => v.toExponential(2);
console.log("与 colour-science 的最大偏差：");
console.log(`  XYZ   ${pct(worst.XYZ)}   (阈值 ${TOL.XYZ})`);
console.log(`  Lab   ${pct(worst.Lab)}   (阈值 ${TOL.Lab})`);
console.log(`  RGB   ${pct(worst.RGB)}   (阈值 ${TOL.RGB})`);
console.log(`  RGB(色适应后) ${pct(worst.RGBa)}   (阈值 ${TOL.RGBa})`);
console.log(`  ΔE    ${pct(worst.dE)}   (阈值 ${TOL.dE})`);
console.log(`  白点  ${pct(worst.white)}   (阈值 ${TOL.white})`);
console.log(`  算例 ${ref.cases.length} 个 / 色差对 ${ref.pairs.length} 个`);

if (fails.length) {
  console.error(`\n失败 ${fails.length} 项：`);
  fails.slice(0, 20).forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log("\nPASS");
