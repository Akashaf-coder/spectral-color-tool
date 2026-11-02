/* csv.js — CSV / 粘贴文本的光谱解析、格式猜测、重采样
 *
 * 设计原则
 *   1. 先猜再改：自动猜表头行数、波长列、数值列、单位，猜完给用户改
 *   2. 不猜就报错：猜不出来时明确告诉你"缺什么"，而不是静默出错值
 *   3. 单位归一到 0~1（反射率）或相对值（光源），归一化动作写在 warnings 里
 */
(function (global) {
  "use strict";

  const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  function isNum(s) {
    if (s === null || s === undefined) return false;
    const t = String(s).trim().replace(/^"(.*)"$/, "$1");
    return t !== "" && NUM_RE.test(t);
  }

  function num(s) {
    return parseFloat(String(s).trim().replace(/^"(.*)"$/, "$1"));
  }

  /** 拆行拆列，自动识别分隔符（逗号/分号/制表符/空白） */
  function splitRows(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n")
      .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
    if (!lines.length) return [];
    const sample = lines.slice(0, 40).join("\n");
    const counts = {
      ",": (sample.match(/,/g) || []).length,
      ";": (sample.match(/;/g) || []).length,
      "\t": (sample.match(/\t/g) || []).length,
    };
    let delim = null;
    let best = 0;
    for (const [d, c] of Object.entries(counts)) if (c > best) { best = c; delim = d; }
    return lines.map((l) => {
      if (delim) return l.split(delim).map((c) => c.trim());
      return l.trim().split(/\s+/).map((c) => c.trim());
    });
  }

  /** 统计每列的数值占比 */
  function columnStats(rows) {
    const width = Math.max(...rows.map((r) => r.length));
    const stats = [];
    for (let c = 0; c < width; c++) {
      let numeric = 0, total = 0;
      const nums = [];
      rows.forEach((r) => {
        if (r[c] === undefined || r[c] === "") return;
        total++;
        if (isNum(r[c])) { numeric++; nums.push(num(r[c])); }
      });
      stats.push({ col: c, numeric, total, nums, ratio: total ? numeric / total : 0 });
    }
    return stats;
  }

  /**
   * 猜测格式。返回的字段都可以在界面上被用户覆盖。
   * @returns {{headerRows:number, wlCol:number|null, valCol:number, start:number,
   *            step:number, unit:string, irregular:boolean, warnings:string[],
   *            rowCount:number, columns:number}}
   */
  function guess(rows, kind) {
    kind = kind || "reflectance";
    const warnings = [];
    if (!rows.length) throw new Error("文件是空的（或者全是空行/注释行）");

    // 表头行数：第一个"多数单元格是数字"的行的下标
    let headerRows = 0;
    for (let i = 0; i < rows.length; i++) {
      const st = columnStats([rows[i]]);
      const numericCells = st.filter((s) => s.numeric > 0).length;
      if (numericCells >= 2 || (numericCells >= 1 && rows[i].length === 1)) { headerRows = i; break; }
      headerRows = i + 1;
    }
    if (headerRows >= rows.length) throw new Error("找不到数值行：文件里没有可解析的数字");

    const dataRows = rows.slice(headerRows);
    const st = columnStats(dataRows);
    const numericCols = st.filter((s) => s.ratio > 0.8).map((s) => s.col);
    if (!numericCols.length) throw new Error("找不到数值列：除表头外没有稳定的数字列");

    // 波长列：数值列里"严格递增且差值稳定"的那一列，且数值量级像波长
    let wlCol = null;
    let step = 0;
    let irregular = false;
    for (const c of numericCols) {
      const vals = dataRows.map((r) => (isNum(r[c]) ? num(r[c]) : NaN)).filter((v) => !Number.isNaN(v));
      if (vals.length < 3) continue;
      const inRange = vals.every((v) => v >= 200 && v <= 2000);
      let increasing = true;
      for (let i = 1; i < vals.length; i++) if (vals[i] <= vals[i - 1]) { increasing = false; break; }
      if (!inRange || !increasing) continue;
      const d = [];
      for (let i = 1; i < vals.length; i++) d.push(vals[i] - vals[i - 1]);
      const sorted = [...d].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const consistent = d.filter((x) => Math.abs(x - med) < med * 0.05 + 1e-9).length >= d.length * 0.9;
      wlCol = c;
      step = med;
      irregular = !consistent;
      break;
    }

    // 数值列：优先取波长列右边一列；否则取数值最多的列
    const valueCandidates = numericCols.filter((c) => c !== wlCol);
    let valCol;
    if (wlCol !== null && valueCandidates.includes(wlCol + 1)) {
      valCol = wlCol + 1;
    } else {
      valCol = valueCandidates.sort((a, b) => st[b].numeric - st[a].numeric)[0];
    }
    if (valCol === undefined) throw new Error("找不到数值列：只有一列数字，无法确定哪一列是波长");

    // 起始波长与步长
    let start;
    const valNums = dataRows.map((r) => (isNum(r[valCol]) ? num(r[valCol]) : NaN)).filter((v) => !Number.isNaN(v));
    if (wlCol === null) {
      warnings.push("没找到波长列，请手动填写起始波长和步长（用 1 列数据时最常见）");
      start = 380;
      step = step || 1;
    } else {
      const wlVals = dataRows.map((r) => (isNum(r[wlCol]) ? num(r[wlCol]) : NaN)).filter((v) => !Number.isNaN(v));
      start = wlVals[0];
      if (irregular) warnings.push("波长间隔不一致（可能是 1nm/5nm 混排或跳点），入库时会线性重采样");
    }

    // 单位：反射率超过 1 按百分比；光源一律按相对值（不做归一化）
    const maxV = Math.max(...valNums);
    let unit = "ratio";
    if (kind === "illuminant") {
      unit = "spd";
    } else if (maxV > 1.0001 && maxV <= 100.5) {
      unit = "percent";
      warnings.push("数值超过 1，按百分比（0~100）处理，入库时除以 100");
    } else if (maxV > 100.5) {
      unit = "spd";
      warnings.push("数值超过 100，超出反射率范围，按光源相对光谱（SPD）处理");
    }

    return {
      headerRows, wlCol, valCol, start, step: Math.abs(step) || 1, unit,
      irregular, warnings, rowCount: dataRows.length, columns: st.length,
    };
  }

  /**
   * 按（可能被用户改过的）设置构建序列
   * @param {string[][]} rows  splitRows 的结果
   * @param {object} opt  {headerRows, wlCol, valCol, start, step, unit}
   * @returns {{start:number, step:number, values:number[], warnings:string[]}}
   */
  function buildSeries(rows, opt) {
    const warnings = [];
    const dataRows = rows.slice(opt.headerRows || 0);
    const pairs = [];
    dataRows.forEach((r) => {
      const vRaw = r[opt.valCol];
      if (!isNum(vRaw)) return;
      let v = num(vRaw);
      if (opt.unit === "percent") v /= 100;
      if (opt.wlCol === null || opt.wlCol === undefined) {
        pairs.push({ wl: null, v });
      } else {
        const wlRaw = r[opt.wlCol];
        if (!isNum(wlRaw)) return;
        pairs.push({ wl: num(wlRaw), v });
      }
    });
    if (pairs.length < 2) throw new Error("有效数据点不足 2 个");

    let start, step;
    if (opt.wlCol === null || opt.wlCol === undefined) {
      start = Number(opt.start);
      step = Number(opt.step) || 1;
      if (!Number.isFinite(start)) throw new Error("缺少起始波长");
    } else {
      pairs.sort((a, b) => a.wl - b.wl);
      start = pairs[0].wl;
      const d = [];
      for (let i = 1; i < pairs.length; i++) d.push(pairs[i].wl - pairs[i - 1].wl);
      const sorted = [...d].sort((a, b) => a - b);
      step = sorted[Math.floor(sorted.length / 2)];
      if (!step || step <= 0) throw new Error("波长列不是递增的，无法确定步长");
      const irregular = d.some((x) => Math.abs(x - step) > step * 0.01);
      if (irregular) {
        const grid = [];
        const lo = pairs[0].wl, hi = pairs[pairs.length - 1].wl;
        const count = Math.floor((hi - lo) / step) + 1;
        for (let i = 0; i < count; i++) grid.push(lo + i * step);
        const resampled = grid.map((wl) => {
          // 线性插值
          let j = 0;
          for (let i = 0; i < pairs.length - 1; i++) if (pairs[i].wl <= wl && wl <= pairs[i + 1].wl) { j = i; break; }
          const a = pairs[j], b = pairs[j + 1] || a;
          const t = b.wl === a.wl ? 0 : (wl - a.wl) / (b.wl - a.wl);
          return a.v + (b.v - a.v) * t;
        });
        warnings.push(`波长间隔不一致，已线性重采样到 ${step}nm 网格（${count} 点）`);
        return { start: grid[0], step, values: resampled, warnings };
      }
      return { start, step, values: pairs.map((p) => p.v), warnings };
    }

    const count = Math.floor(pairs.length);
    return { start, step, values: pairs.slice(0, count).map((p) => p.v), warnings };
  }

  /** 生成 CSV 文本（用于导出结果） */
  function toCsv(rows) {
    return rows.map((r) => r.map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n") + "\n";
  }

  global.COSPEC = global.COSPEC || {};
  global.COSPEC.csv = { splitRows, guess, buildSeries, toCsv, isNum, num, columnStats };
})(typeof window !== "undefined" ? window : globalThis);
