// test/csv.test.mjs — CSV 解析与猜测测试
//   node test/csv.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console, Math, JSON, Number, String };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "csv.js"), "utf8"), sandbox);
const CSV = sandbox.COSPEC.csv;

let pass = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? " → " + detail : ""}`);
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// 1) 带表头、逗号、5nm
{
  const text = `波长,反射率
400,0.120
405,0.125
410,0.131
415,0.140`;
  const rows = CSV.splitRows(text);
  const g = CSV.guess(rows);
  check("1 表头行数", g.headerRows === 1, `得到 ${g.headerRows}`);
  check("1 波长列", g.wlCol === 0, `得到 ${g.wlCol}`);
  check("1 数值列", g.valCol === 1, `得到 ${g.valCol}`);
  check("1 起始/步长", g.start === 400 && g.step === 5, `${g.start}/${g.step}`);
  const s = CSV.buildSeries(rows, g);
  check("1 数值", s.values.length === 4 && near(s.values[3], 0.14), JSON.stringify(s.values));
}

// 2) 无表头、制表符、SPD
{
  const text = "380\t1.2\n385\t1.5\n390\t1.9\n395\t2.4\n";
  const rows = CSV.splitRows(text);
  const g = CSV.guess(rows, "illuminant");
  check("2 无表头", g.headerRows === 0);
  check("2 单位 spd", g.unit === "spd", g.unit);
  const s = CSV.buildSeries(rows, g);
  check("2 数值", s.values.length === 4 && near(s.values[0], 1.2));
}

// 3) 只有一列数值（缺波长列）
{
  const text = "0.12\n0.13\n0.14\n0.15\n";
  const rows = CSV.splitRows(text);
  const g = CSV.guess(rows);
  check("3 无波长列", g.wlCol === null, String(g.wlCol));
  check("3 有警告", g.warnings.length > 0);
  const s = CSV.buildSeries(rows, { ...g, start: 400, step: 10 });
  check("3 起始由用户给", s.start === 400 && s.step === 10, `${s.start}/${s.step}`);
  check("3 数值", s.values.length === 4 && near(s.values[1], 0.13));
}

// 4) 百分比
{
  const text = `"Wavelength (nm)","Reflectance (%)"
400,12.0
405,12.5
410,13.1`;
  const rows = CSV.splitRows(text);
  const g = CSV.guess(rows);
  check("4 百分号单位", g.unit === "percent", g.unit);
  const s = CSV.buildSeries(rows, g);
  check("4 已除以 100", near(s.values[0], 0.12), String(s.values[0]));
}

// 5) 间隔不一致 → 重采样
{
  const rows = CSV.splitRows("400 0.1\n402 0.2\n410 0.3\n411 0.4\n420 0.5");
  const g = CSV.guess(rows);
  const s = CSV.buildSeries(rows, g);
  check("5 有重采样警告", s.warnings.length > 0, JSON.stringify(s.warnings));
  check("5 网格均匀", near(s.start, 400), String(s.start));
}

// 6) 分号分隔 + 多余列（序号、时间戳）
{
  const text = `No;nm;value
1;500;0.5
2;505;0.6
3;510;0.7`;
  const rows = CSV.splitRows(text);
  const g = CSV.guess(rows);
  check("6 认出波长列", g.wlCol === 1, String(g.wlCol));
  check("6 认出数值列", g.valCol === 2, String(g.valCol));
}

// 7) 乱数据：全是文字
{
  let threw = false;
  try { CSV.guess(CSV.splitRows("hello\nworld")); } catch (e) { threw = true; }
  check("7 无数字时抛错", threw);
}

console.log(`通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项` : ""}`);
if (fails.length) {
  fails.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log("PASS");
