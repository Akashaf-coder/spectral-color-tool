/* app.js — 界面逻辑（无框架、无构建） */
(function () {
  "use strict";
  const C = window.COSPEC.color;
  const CSV = window.COSPEC.csv;
  const CORE = window.COSPEC_CORE;
  const KEY = "specolor.library.v1";
  const SPACES = ["sRGB", "Display P3", "Adobe RGB (1998)"];

  const $ = (id) => document.getElementById(id);
  const fmt = (v, d) => {
    if (!Number.isFinite(v)) return "—";
    const n = Math.abs(v) < 1e-9 ? 0 : v;   // 去掉 -0.00
    return n.toFixed(d === undefined ? 2 : d);
  };
  const uid = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------------- 状态 ---------------- */

  const state = {
    library: { version: 1, items: [] },
    selectedId: null,
    observer: "2deg",
    space: "sRGB",
    showIllum: true,
    adapt: true,
    illumName: "D65",
    tab: "lab",
    measured: {},
    last: null,
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const lib = JSON.parse(raw);
        if (lib && Array.isArray(lib.items)) state.library = lib;
      } else {
        seed();
      }
    } catch (e) {
      console.warn("读取本地库失败，使用示例数据", e);
      seed();
    }
    if (!state.library.items.length) seed();
    state.selectedId = state.library.items[0] ? state.library.items[0].id : null;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.library));
    } catch (e) {
      alert("保存到浏览器本地存储失败：" + e.message + "\n请用「导出库」备份。");
    }
  }

  /* ---------------- 示例数据 ---------------- */

  function seed() {
    const grid = (start, step, n) => Array.from({ length: n }, (_, i) => start + i * step);
    const mk = (name, start, step, fn, note) => ({
      id: uid(), kind: "reflectance", name, note: note || "",
      start, step, values: grid(start, step, Math.round((780 - start) / step) + 1).map(fn),
      source: "sample", createdAt: new Date().toISOString(),
    });
    state.library = {
      version: 1,
      items: [
        mk("18% 中性灰", 380, 5, () => 0.18, "标准灰卡"),
        mk("白纸（亚光）", 380, 5, (w) => 0.78 + 0.12 * Math.sin(((w - 380) / 400) * Math.PI), ""),
        mk("橙色涂料", 380, 5, (w) => Math.max(0.02, 0.05 + 0.9 * Math.pow(Math.max(0, (w - 400) / 300), 2)), ""),
        mk("窄带绿（550nm）", 380, 1, (w) => 0.02 + 0.75 * Math.exp(-Math.pow((w - 550) / 12, 2)), "用于观察超出色域"),
      ],
    };
  }

  /* ---------------- 库渲染 ---------------- */

  function itemById(id) {
    return state.library.items.find((i) => i.id === id) || null;
  }

  function toSD(item) {
    return { start: item.start, step: item.step, values: item.values };
  }

  function reflItems() {
    return state.library.items.filter((i) => i.kind !== "illuminant");
  }

  function illumItems() {
    return state.library.items.filter((i) => i.kind === "illuminant");
  }

  function renderLibrary() {
    const ul = $("listRefl");
    const items = reflItems();
    ul.innerHTML = items.map((it) => {
      let dot = "#ddd";
      try {
        const r = C.compute({ refl: toSD(it), illum: C.illuminant("D65"), observerKey: "2deg", spaces: ["sRGB"], adapt: state.adapt });
        dot = r.rgb.sRGB.hex;
      } catch (e) { /* 忽略 */ }
      return `<li data-id="${it.id}" class="${it.id === state.selectedId ? "active" : ""}">
        <span class="swatchdot" style="background:${dot}"></span>
        <span class="name" title="${esc(it.name)}">${esc(it.name)}</span>
        <span class="meta">${it.start}–${Math.round(it.start + it.step * (it.values.length - 1))}nm / ${it.step}nm</span>
        <button class="del" data-del="${it.id}" title="删除">×</button>
      </li>`;
    }).join("");
    $("emptyRefl").hidden = items.length > 0;

    ul.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.dataset.del) return;
        state.selectedId = li.dataset.id;
        renderLibrary();
        recompute();
      });
      li.addEventListener("dblclick", () => {
        const it = itemById(li.dataset.id);
        const name = prompt("重命名", it.name);
        if (name && name.trim()) { it.name = name.trim(); save(); renderLibrary(); renderResult(); }
      });
    });
    ul.querySelectorAll("[data-del]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const it = itemById(b.dataset.del);
        if (!confirm(`删除「${it.name}」？`)) return;
        state.library.items = state.library.items.filter((x) => x.id !== it.id);
        if (state.selectedId === it.id) state.selectedId = reflItems()[0] ? reflItems()[0].id : null;
        save(); renderLibrary(); recompute();
      });
    });
  }

  function renderIllumSelect() {
    const sel = $("selIllum");
    const groups = CORE.illuminant_groups || {};
    const opts = [];
    const push = (label, names) => {
      if (!names || !names.length) return;
      opts.push(`<optgroup label="${esc(label)}">` +
        names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("") + "</optgroup>");
    };
    push("标准光源", groups["标准光源"]);
    push("荧光灯", groups["荧光灯 FL"]);
    push("LED", groups["LED"]);
    push("高压放电灯", groups["高压放电灯 HP"]);
    const libs = illumItems();
    if (libs.length) {
      opts.push(`<optgroup label="我的库">` +
        libs.map((i) => `<option value="lib:${i.id}">${esc(i.name)}</option>`).join("") + "</optgroup>");
    }
    const known = new Set([].concat(...Object.values(groups)).concat(libs.map((i) => "lib:" + i.id)));
    sel.innerHTML = opts.join("") +
      (known.has(state.illumName) ? "" : `<option value="${esc(state.illumName)}">${esc(state.illumName)}</option>`);
    sel.value = state.illumName;
    const total = Object.keys(CORE.illuminants).length + libs.length;
    $("illumHint").textContent = `内置 ${Object.keys(CORE.illuminants).length} 个 CIE 标准光源，库里 ${libs.length} 个（共 ${total}），数据 300–780nm / 5nm。`;
  }

  /* ---------------- 计算 ---------------- */

  function currentIllumSD() {
    if (state.illumName.startsWith("lib:")) {
      const it = itemById(state.illumName.slice(4));
      if (!it) throw new Error("光源已被删除，请重新选择");
      return toSD(it);
    }
    return C.illuminant(state.illumName);
  }

  function recompute() {
    const it = itemById(state.selectedId);
    if (!it) { renderEmpty(); return; }
    let r;
    try {
      r = C.compute({
        refl: toSD(it), illum: currentIllumSD(),
        observerKey: state.observer, spaces: SPACES, adapt: state.adapt,
      });
    } catch (e) {
      $("resName").textContent = "计算失败：" + e.message;
      return;
    }
    state.last = { item: it, result: r };
    renderResult();
    renderPlot();
    renderMeasured();
  }

  function renderEmpty() {
    state.last = null;
    $("chipMain").className = "chip";
    $("chipMain").innerHTML = "";
    $("resName").textContent = "左侧选一条反射率";
    ["vXYZ", "vLab", "vLCh", "vSrgb", "vP3", "vAdobe", "vHex"].forEach((id) => { $(id).textContent = "—"; });
    $("rangeBadge").textContent = "—";
    $("gamutTag").textContent = "";
    $("wpLine").textContent = "";
    drawPlot($("plot"), []);
  }

  function renderResult() {
    if (!state.last) return;
    const { item, result } = state.last;
    const sp = state.space;
    const obj = result.rgb[sp];
    const chip = $("chipMain");
    chip.innerHTML = `<div class="fill" style="background:${obj.hex}"></div>` +
      (obj.inside ? "" : `<div class="outgamut" title="超出 ${sp} 色域"></div>`);
    $("gamutTag").textContent = obj.inside ? "" : `超出 ${sp} 色域`;

    $("resName").textContent = `${item.name} · ${state.illumName.replace(/^lib:/, "")} · ${state.observer === "2deg" ? "2°" : "10°"}`;
    $("vXYZ").textContent = result.XYZ.map((v) => fmt(v, 2)).join("   ");
    $("vLab").textContent = result.Lab.map((v) => fmt(v, 2)).join("   ");
    $("vLCh").textContent = `${fmt(result.LCh[0], 2)}   ${fmt(result.LCh[1], 1)}   ${fmt(result.LCh[2], 1)}°`;
    SPACES.forEach((s) => {
      const o = result.rgb[s];
      const el = $(s === "sRGB" ? "vSrgb" : s === "Display P3" ? "vP3" : "vAdobe");
      el.innerHTML = `${o.rgb.map((v) => fmt(v, 3)).join("   ")}` +
        `<span class="sub8">8bit ${o.clipped.map((v) => Math.round(v * 255)).join(", ")}</span>` +
        (o.inside ? "" : `<span class="tag" style="margin-left:8px">超色域</span>`);
    });
    $("vHex").textContent = obj.hex;
    $("rangeBadge").textContent = `积分 ${result.range.lo}–${result.range.hi}nm @${result.range.step}nm`;
    $("wpLine").textContent = `参考白（完美漫反射体）：X ${fmt(result.whitePoint[0], 2)} / Y ${fmt(result.whitePoint[1], 2)} / Z ${fmt(result.whitePoint[2], 2)}`;
  }

  /* ---------------- 曲线图 ---------------- */

  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(120, rect.height || 260);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w @param {number} h
   * @param {Array} series [{sd, color, dash, label, scaleToMax}]
   */
  function drawChart(cv, series, opt) {
    opt = opt || {};
    const { ctx, w, h } = setupCanvas(cv);
    const pad = { l: 46, r: 12, t: 12, b: 26 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    if (!series.length) {
      ctx.fillStyle = "#a0a0a8"; ctx.font = "12px sans-serif";
      ctx.fillText("暂无数据", pad.l, pad.t + 20);
      return;
    }
    let lo = Infinity, hi = -Infinity, yMax = 0;
    series.forEach((s) => {
      lo = Math.min(lo, s.sd.start);
      hi = Math.max(hi, C.sdEnd(s.sd));
      s.sd.values.forEach((v) => { if (Number.isFinite(v)) yMax = Math.max(yMax, v); });
    });
    // x 轴以主曲线（第一条）为准，光源只画在重叠区间内
    if (!opt.fixedX && series[0]) {
      lo = series[0].sd.start;
      hi = C.sdEnd(series[0].sd);
    }
    if (opt.fixedX) { lo = opt.fixedX[0]; hi = opt.fixedX[1]; }
    lo = Math.max(300, lo); hi = Math.min(900, hi);
    yMax = opt.fixedY ? opt.fixedY : Math.max(0.05, yMax * 1.08);
    const X = (nm) => pad.l + ((nm - lo) / (hi - lo)) * pw;
    const Y = (v) => pad.t + ph - (v / yMax) * ph;

    // 网格
    ctx.strokeStyle = "#eeeef1"; ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, Menlo, monospace"; ctx.fillStyle = "#a0a0a8";
    const xStep = hi - lo > 400 ? 100 : 50;
    for (let nm = Math.ceil(lo / xStep) * xStep; nm <= hi; nm += xStep) {
      ctx.beginPath(); ctx.moveTo(X(nm), pad.t); ctx.lineTo(X(nm), pad.t + ph); ctx.stroke();
      ctx.fillText(String(nm), X(nm) - 10, h - 8);
    }
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4, y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
      ctx.fillText(v.toFixed(2), 6, y + 3);
    }
    ctx.strokeStyle = "#d8d8dd";
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();

    // 曲线（裁剪到绘图区内，光源超出反射率范围的部分不会溢出）
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, pw, ph + 1);
    ctx.clip();
    series.forEach((s) => {
      let peak = 1;
      if (s.scaleToMax) peak = Math.max(...s.sd.values.filter(Number.isFinite)) || 1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.sd.values.length; i++) {
        const nm = s.sd.start + s.sd.step * i;
        const v = s.sd.values[i] / peak;
        if (!Number.isFinite(v)) continue;
        const x = X(nm), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6;
      ctx.setLineDash(s.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.fill) {
        ctx.lineTo(X(s.sd.start + s.sd.step * (s.sd.values.length - 1)), pad.t + ph);
        ctx.lineTo(X(s.sd.start), pad.t + ph);
        ctx.closePath();
        ctx.fillStyle = s.fill; ctx.fill();
      }
    });
    ctx.restore();

    // 图例
    let lx = pad.l + 6;
    series.forEach((s) => {
      if (!s.label) return;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath(); ctx.moveTo(lx, pad.t + 4); ctx.lineTo(lx + 16, pad.t + 4); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6a6a72"; ctx.font = "11px -apple-system, sans-serif";
      ctx.fillText(s.label, lx + 21, pad.t + 8);
      lx += ctx.measureText(s.label).width + 40;
    });
  }

  function renderPlot() {
    if (!state.last) return;
    const { item, result } = state.last;
    const series = [{
      sd: toSD(item), color: "#2f6feb", label: "反射率", width: 1.8, fill: "rgba(47,111,235,.07)",
    }];
    if (state.showIllum) {
      series.push({ sd: currentIllumSD(), color: "#d97706", label: "光源（峰值归一）", dash: [5, 3], scaleToMax: true });
    }
    $("plotHint").textContent = `${item.start}nm 起 / 步长 ${item.step}nm / ${item.values.length} 点`;
    drawChart($("plot"), series, { fixedY: 1 });
  }

  /* ---------------- 实测对比 ---------------- */

  function measuredLab() {
    const r = state.last;
    if (!r) return null;
    const wp = r.result.whitePoint;
    const wl = $("mL1").value, wa = $("mL2").value, wb = $("mL3").value;
    if (state.tab === "lab") {
      if (wl === "" || wa === "" || wb === "") return null;
      const vals = [Number(wl), Number(wa), Number(wb)];
      if (vals.some((v) => !Number.isFinite(v))) return null;
      if ($("selLabFmt").value === "lab") return vals;
      return C.xyzToLab(vals, wp);
    }
    if (state.tab === "rgb") {
      const raw = [$("mR").value, $("mG").value, $("mB").value];
      if (raw.some((v) => v === "")) return null;
      const scale = Number($("selMRgbScale").value);
      const rgb01 = raw.map((v) => Number(v) / scale);
      if (rgb01.some((v) => !Number.isFinite(v))) return null;
      const XYZ = C.rgbToXyz(rgb01, $("selMRgbSpace").value);
      return C.xyzToLab(XYZ, wp);
    }
    if (state.tab === "spec") {
      const text = $("mSpec").value.trim();
      if (!text) return null;
      try {
        const rows = CSV.splitRows(text);
        const g = CSV.guess(rows, "reflectance");
        const s = CSV.buildSeries(rows, g);
        const res = C.compute({
          refl: s, illum: currentIllumSD(), observerKey: state.observer, spaces: SPACES, adapt: state.adapt,
        });
        return res.Lab;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function verdict(de) {
    if (!Number.isFinite(de)) return "";
    if (de < 1) return "几乎相同";
    if (de < 2) return "肉眼难辨";
    if (de < 5) return "专业可辨";
    if (de < 10) return "明显不同";
    return "完全不同";
  }

  function renderMeasured() {
    const lab = measuredLab();
    if (!lab || !state.last) {
      $("figMeasured").hidden = true;
      $("vDE00").textContent = "—";
      $("vDE76").textContent = "—";
      $("vDE00Verdict").textContent = "";
      return;
    }
    const XYZ = C.labToXyz(lab, state.last.result.whitePoint);
    const rgb = C.xyzToRgb(XYZ, state.space);
    const g = C.gamut(rgb);
    $("figMeasured").hidden = false;
    $("chipMeasured").className = "chip";
    $("chipMeasured").innerHTML = `<div class="fill" style="background:${C.rgbToHex(g.clipped)}"></div>` +
      (g.inside ? "" : `<div class="outgamut"></div>`);
    const d00 = C.deltaE2000(state.last.result.Lab, lab);
    const d76 = C.deltaE76(state.last.result.Lab, lab);
    $("vDE00").textContent = fmt(d00, 2);
    $("vDE76").textContent = fmt(d76, 2);
    $("vDE00Verdict").textContent = verdict(d00);
  }

  /* ---------------- 弹窗：导入 / 手动 ---------------- */

  let modalRows = null;

  function openModal(kind) {
    $("modal").hidden = false;
    $("mTitle").textContent = kind === "illuminant" ? "导入光源 SPD" : "导入 / 手动输入光谱";
    $("imKind").value = kind;
    $("imName").value = "";
    $("imText").value = "";
    $("imWarn").hidden = true;
    $("imWarn").textContent = "";
    $("imRaw").textContent = "";
    ["imHeader", "imWl", "imVal", "imStart", "imStep"].forEach((id) => { $(id).value = ""; });
    $("imUnit").value = "ratio";
    modalRows = null;
    drawChart($("imPlot"), []);
    $("imName").focus();
  }

  function closeModal() { $("modal").hidden = true; }

  function modalText() { return $("imText").value.trim(); }

  function reparse(useGuess) {
    const text = modalText();
    const warn = $("imWarn");
    if (!text) { modalRows = null; drawChart($("imPlot"), []); warn.hidden = true; return; }
    try {
      modalRows = CSV.splitRows(text);
      const kind = $("imKind").value;
      if (useGuess) {
        const g = CSV.guess(modalRows, kind);
        $("imHeader").value = g.headerRows;
        $("imWl").value = g.wlCol === null ? "" : g.wlCol;
        $("imVal").value = g.valCol;
        $("imStart").value = Math.round(g.start);
        $("imStep").value = Math.round(g.step * 1000) / 1000;
        $("imUnit").value = g.unit;
        if (g.warnings.length) showWarn(g.warnings.join("；"));
      }
      const opt = readOpt();
      const s = CSV.buildSeries(modalRows, opt);
      if (s.warnings.length) showWarn(s.warnings.join("；"));
      drawChart($("imPlot"), [{
        sd: s, color: "#2f6feb", label: "预览", width: 1.8, fill: "rgba(47,111,235,.07)",
      }]);
      $("imRaw").textContent = modalRows.slice(0, 8).map((r) => r.join("  ")).join("\n") +
        (modalRows.length > 8 ? `\n… 共 ${modalRows.length} 行` : "");
    } catch (e) {
      modalRows = null;
      drawChart($("imPlot"), []);
      showWarn(e.message);
    }
  }

  function showWarn(msg) {
    const w = $("imWarn");
    w.hidden = false;
    w.textContent = msg;
  }

  function readOpt() {
    const wlRaw = $("imWl").value;
    return {
      headerRows: Number($("imHeader").value) || 0,
      wlCol: wlRaw === "" ? null : Number(wlRaw),
      valCol: Number($("imVal").value) || 0,
      start: Number($("imStart").value),
      step: Number($("imStep").value) || 1,
      unit: $("imUnit").value,
    };
  }

  function saveModal() {
    const text = modalText();
    if (!text) { alert("先粘贴或选择一个文件"); return; }
    let series;
    try {
      if (!modalRows) modalRows = CSV.splitRows(text);
      series = CSV.buildSeries(modalRows, readOpt());
    } catch (e) {
      alert("解析失败：" + e.message);
      return;
    }
    const name = ($("imName").value || "").trim() || `未命名 ${new Date().toLocaleString("zh-CN")}`;
    const kind = $("imKind").value;
    const item = {
      id: uid(), kind, name,
      start: series.start, step: series.step,
      values: series.values.map((v) => Math.round(v * 1e6) / 1e6),
      source: "csv", createdAt: new Date().toISOString(),
    };
    state.library.items.push(item);
    save();
    closeModal();
    if (kind === "illuminant") {
      state.illumName = "lib:" + item.id;
      renderIllumSelect();
    } else {
      state.selectedId = item.id;
      renderLibrary();
    }
    recompute();
  }

  /* ---------------- 导出 ---------------- */

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function exportLibrary() {
    download("library.json", JSON.stringify(state.library, null, 2), "application/json");
  }

  function exportResult() {
    if (!state.last) { alert("先选一条反射率"); return; }
    const { item, result } = state.last;
    const lab = measuredLab();
    const n4 = (v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4);
    const head = ["名称", "光源", "观察者", "积分区间", "X", "Y", "Z", "L*", "a*", "b*",
      "sRGB_R", "sRGB_G", "sRGB_B",
      "P3_R", "P3_G", "P3_B",
      "AdobeR", "AdobeG", "AdobeB",
      "HEX", "超色域", "ΔE00", "ΔE76"];
    const row = [
      item.name, state.illumName.replace(/^lib:/, ""), state.observer,
      `${result.range.lo}-${result.range.hi}nm@${result.range.step}nm`,
      ...result.XYZ.map(n4),
      ...result.Lab.map(n4),
      ...SPACES.flatMap((s) => result.rgb[s].rgb.map((v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(5))),
      result.rgb[state.space].hex,
      SPACES.filter((s) => !result.rgb[s].inside).join("/") || "无",
      lab ? C.deltaE2000(result.Lab, lab).toFixed(3) : "",
      lab ? C.deltaE76(result.Lab, lab).toFixed(3) : "",
    ];
    download(`${item.name}-${state.illumName.replace(/^lib:/, "")}.csv`, CSV.toCsv([head, row]), "text/csv;charset=utf-8");
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    $("btnImportCsv").addEventListener("click", () => openModal("reflectance"));
    $("btnManual").addEventListener("click", () => {
      openModal($("imKind").value === "illuminant" ? "reflectance" : "reflectance");
      $("mTitle").textContent = "手动输入光谱";
      $("imText").placeholder = "每行一条：波长 数值\n400 0.120\n405 0.125";
      $("imName").value = "手动输入 " + new Date().toLocaleDateString("zh-CN");
    });
    $("btnSample").addEventListener("click", () => {
      if (!confirm("重新载入示例数据？当前库里的自定义条目会被清除（建议先导出库）。")) return;
      seed(); state.selectedId = state.library.items[0].id;
      save(); renderLibrary(); recompute();
    });

    $("selIllum").addEventListener("change", (e) => { state.illumName = e.target.value; recompute(); });
    $("selObserver").addEventListener("change", (e) => { state.observer = e.target.value; recompute(); });
    $("selSpace").addEventListener("change", (e) => { state.space = e.target.value; renderResult(); renderMeasured(); });
    $("chkIllum").addEventListener("change", (e) => { state.showIllum = e.target.checked; renderPlot(); });
    $("chkAdapt").addEventListener("change", (e) => {
      state.adapt = e.target.checked;
      $("caliberHint").textContent = state.adapt
        ? "口径：1nm 等间隔积分（线性插值到 1nm）、相对色度（Y 归一 100）、Bradford 色适应到显示空间白点。"
        : "口径：1nm 等间隔积分、相对色度（Y 归一 100）、未做色适应 —— 这是「相机未白平衡」的视图，非 D65 光源下色块会明显偏色。";
      renderLibrary(); recompute();
    });

    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => {
        state.tab = t.dataset.mode;
        document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
        document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== state.tab; });
        renderMeasured();
      });
    });
    ["mL1", "mL2", "mL3", "mR", "mG", "mB", "mSpec"].forEach((id) => {
      $(id).addEventListener("input", renderMeasured);
    });
    $("selLabFmt").addEventListener("change", (e) => {
      const lab = e.target.value === "lab";
      $("uL1").textContent = lab ? "L*" : "X";
      $("uL2").textContent = lab ? "a*" : "Y";
      $("uL3").textContent = lab ? "b*" : "Z";
      renderMeasured();
    });
    ["selMRgbSpace", "selMRgbScale"].forEach((id) => $(id).addEventListener("change", renderMeasured));
    $("btnExportResult").addEventListener("click", exportResult);
    $("btnExportLib").addEventListener("click", exportLibrary);
    $("btnImportLib").addEventListener("click", () => $("fileLib").click());
    $("fileLib").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const lib = JSON.parse(fr.result);
          if (!lib || !Array.isArray(lib.items)) throw new Error("不是有效的库文件");
          if (!confirm(`导入 ${lib.items.length} 条数据，替换当前库？`)) return;
          state.library = lib;
          state.selectedId = lib.items[0] ? lib.items[0].id : null;
          save(); renderLibrary(); renderIllumSelect(); recompute();
        } catch (err) {
          alert("导入失败：" + err.message);
        }
      };
      fr.readAsText(f);
      e.target.value = "";
    });

    // 弹窗
    $("mClose").addEventListener("click", closeModal);
    $("mCancel").addEventListener("click", closeModal);
    $("mSave").addEventListener("click", saveModal);
    $("imFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        $("imText").value = fr.result;
        if (!$("imName").value) $("imName").value = f.name.replace(/\.[^.]+$/, "");
        reparse(true);
      };
      fr.readAsText(f);
    });
    $("imText").addEventListener("input", () => reparse(true));
    ["imHeader", "imWl", "imVal", "imStart", "imStep", "imUnit", "imKind"].forEach((id) => {
      $(id).addEventListener("change", () => reparse(false));
    });
    $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
    window.addEventListener("resize", () => { if (state.last) renderPlot(); });
  }

  /* ---------------- 启动 ---------------- */

  load();
  bind();
  renderIllumSelect();
  renderLibrary();
  $("selObserver").value = state.observer;
  $("selSpace").value = state.space;
  recompute();
  window.__SPECOLOR__ = { state, C, CSV };
})();
