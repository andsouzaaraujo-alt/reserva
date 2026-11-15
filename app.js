"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const CARD_ORDER = ["inter", "nu_pf", "nu_pj", "bradesco"];
const LIGHT_TEXT = { inter: true, nu_pf: true };
const SHORT = { inter: "Inter", nu_pf: "Nu PF", nu_pj: "Nu PJ", bradesco: "Bradesco" };
const MES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const USER_NAME = "Andrea";   // nome na saudação do Início
let S = null;            // estado vindo da planilha
let month = null;        // mês selecionado (YYYY-MM)
let lastMtime = 0;

const brl = (v, cents = true) => v.toLocaleString("pt-BR", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
// "R$ 1.234,56" para valores pequenos (o R$ fica ao lado); espaço não separável
const rs = (v, cents = true) => `${v < 0 ? "−" : ""}R$\u00a0${brl(Math.abs(v), cents)}`;
const col = (v, cents = true) => `<span class="money"><span class="cur">R$</span><span class="amt">${v < 0 ? "−" : ""}${brl(Math.abs(v), cents)}</span></span>`;
const signed = (d, cents = false) => `${d >= 0 ? "+" : "−"}R$\u00a0${brl(Math.abs(d), cents)}`;
const label = k => { const [y, m] = k.split("-"); return `${MES[+m - 1]}/${y.slice(2)}`; };
const ddmm = iso => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const parseAmount = s => {
  s = String(s || "").replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Ponte do site (GitHub Pages) com o motor no Google Apps Script.
// Cada pedido leva a chave do app, que fica guardada só neste aparelho.
const API_URL = "https://script.google.com/macros/s/AKfycbx5FCTRzJIU-gSBFxpaxvpHzvuUPwqkqJfTv0-Sj_ks0AmeYhU-MH7EGswEPzzTLGOr/exec";
const KEY_STORE = "reserva.chave";

function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* sem armazenamento: pede de novo */ } }
function clearKey() { try { localStorage.removeItem(KEY_STORE); } catch (e) { /* idem */ } }

async function gasRun(fn, arg) {
  const key = getKey();
  if (!key) { askKey(); throw new Error("Missing app key"); }
  let j;
  try {
    // text/plain evita o pedido de verificação (CORS) que o Apps Script não responde
    const r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ key, fn, arg: arg ?? null }) });
    j = await r.json();
  } catch (e) { throw new Error("No connection to the spreadsheet"); }
  if (!j.ok) {
    if (j.error === "CHAVE_INVALIDA") { clearKey(); askKey("Key not recognized. Check it and paste again."); throw new Error("Invalid app key"); }
    throw new Error(j.error);
  }
  return j.data;
}

// tela de chave: aparece só na primeira vez (ou se a chave estiver errada)
function askKey(msg) {
  let d = document.getElementById("dlg-key");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "dlg-key";
    d.className = "sheet";
    d.innerHTML = `<form method="dialog" class="sheet-in" id="form-key">
      <div class="sheet-head"><span class="mono"><span class="dia">◇</span> First access</span></div>
      <h3 class="serif">App <em>key</em></h3>
      <p class="note" id="key-msg">Paste the app key (file CHAVE-DO-APP.txt on the Mac). It is stored only on this device.</p>
      <div class="field"><label class="lab mono" for="key-in">Key</label>
        <input id="key-in" class="in" autocomplete="off" autocapitalize="off" spellcheck="false" required></div>
      <button class="submit" type="submit">Enter</button>
    </form>`;
    document.body.appendChild(d);
    d.addEventListener("cancel", e => e.preventDefault());   // sem chave não dá para usar o app
    d.querySelector("#form-key").addEventListener("submit", ev => {
      ev.preventDefault();
      const k = d.querySelector("#key-in").value.trim();
      if (!k) return;
      setKey(k);
      d.close();
      load(true);
    });
  }
  if (msg) d.querySelector("#key-msg").textContent = msg;
  if (!d.open) d.showModal();
}

// mesma regra de fatura do servidor, calculada aqui para a prévia ficar instantânea
function gasPreview(b) {
  const pad = n => String(n).padStart(2, "0");
  const addM = (key, n) => { const [y, m] = key.split("-").map(Number); const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`; };
  const card = S.cards[b.card];
  const [y, m, d] = b.date.split("-").map(Number);
  let closeKey = `${y}-${pad(m)}`;
  if (d >= card.close) closeKey = addM(closeKey, 1);
  const dueKey = card.due <= card.close ? addM(closeKey, 1) : closeKey;
  const mk = (key, day) => { const [yy, mm] = key.split("-").map(Number); return `${key}-${pad(Math.min(day, new Date(yy, mm, 0).getDate()))}`; };
  const last = S.months[S.months.length - 1].key;
  let items = [];
  if (b.recurring) { for (let k = dueKey; k <= last; k = addM(k, 1)) items.push({ month: k, value: Math.round(b.amount * 100) / 100 }); }
  else {
    const n = b.installments || 1, cents = Math.round(b.amount * 100), base = Math.floor(cents / n), rest = cents - base * n;
    items = Array.from({ length: n }, (_, i) => ({ month: addM(dueKey, i), value: (base + (i < rest ? 1 : 0)) / 100 }));
  }
  return { card: b.card, first_month: dueKey, close_date: mk(closeKey, card.close), due_date: mk(dueKey, card.due), items };
}

const GAS_ROUTES = {
  "/api/state": "getState", "/api/expense": "addExpense", "/api/fixed": "addFixed",
  "/api/fixed/update": "updateFixed", "/api/close": "closeMonth", "/api/undo": "undo", "/api/config": "saveConfig",
  "/api/delete": "deleteExpense",
};

async function api(path, body) {
  if (path.startsWith("/api/suggest")) return gasRun("suggest", decodeURIComponent(path.split("q=")[1] || ""));
  if (path.startsWith("/api/expenses")) {
    const q = new URLSearchParams(path.split("?")[1] || "");
    return gasRun("listExpenses", { card: q.get("card"), month: q.get("month") });
  }
  if (path === "/api/preview") return gasPreview(body);
  if (path === "/api/config" && !body) return gasRun("getConfig");
  const fn = GAS_ROUTES[path];
  if (!fn) throw new Error("unknown route: " + path);
  return gasRun(fn, body || null);
}


// grava; se o Excel estiver com o arquivo aberto, pergunta antes de forçar
async function write(path, body) {
  try { return await api(path, body); }
  catch (e) {
    if (e.code === "excel_open" && confirm(e.message + "\n\nSave anyway?")) return api(path, { ...body, force: true });
    throw e;
  }
}

// ---------------------------------------------------------------- formas geométricas
const GEO = {
  rings: (w = 1.4) => `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="${w}">
    <circle cx="100" cy="100" r="96"/><circle cx="100" cy="118" r="78"/><circle cx="100" cy="136" r="60"/><circle cx="100" cy="154" r="42"/>
    <g stroke-width="${w + .2}"><path d="M94 22h12"/><path d="M94 58h12M100 52v12"/><path d="M94 94h12"/><path d="M94 154h12M100 148v12"/></g></svg>`,
  venn: () => `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.3">
    <defs><pattern id="vh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" stroke-width="1"/></pattern></defs>
    <circle cx="50" cy="34" r="24"/><circle cx="34" cy="62" r="24"/><circle cx="66" cy="62" r="24"/>
    <path d="M50 52 A24 24 0 0 1 34 38 A24 24 0 0 1 66 38 A24 24 0 0 1 50 52Z" fill="none"/>
    <path d="M38.2 41.2 A24 24 0 0 1 61.8 41.2 A24 24 0 0 1 50 62 A24 24 0 0 1 38.2 41.2Z" fill="url(#vh)" stroke="none"/></svg>`,
  pyramid: () => `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.3">
    <path d="M50 8 L10 88 H90 Z"/><path d="M50 8 L62 78 L90 88"/><path d="M62 78 L10 88"/>
    <path d="M50 8 L60 66 M50 8 L58 54 M50 8 L56 42"/><path d="M60 66 L22 79 M58 54 L28 69 M56 42 L34 58" opacity=".7"/></svg>`,
  cube: () => `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.3">
    <path d="M18 30 L50 14 L82 30 L82 70 L50 86 L18 70 Z"/><path d="M18 30 L50 46 L82 30 M50 46 V86"/>
    <path d="M30 36 L50 26 L70 36 L70 62 L50 72 L30 62 Z" stroke-dasharray="2 3"/></svg>`,
};
const CARD_GEO = { inter: () => GEO.rings(2.4), nu_pf: GEO.venn, nu_pj: GEO.pyramid, bradesco: GEO.cube };

// ---------------------------------------------------------------- render
function render() {
  if (!S) return;
  renderRuler(); renderReserve(); renderFlow(); renderChart(); renderFixed(); renderCards(); renderPageTitle(); renderClosePrompt();
  const t = new Date(S.mtime * 1000);
  $("#foot-time").textContent = "updated " + t.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const b = $("#banner");
  b.hidden = !S.excel_open;
  b.textContent = "The spreadsheet is open in Excel. Close it before adding from the app, or Excel may overwrite what gets saved.";
}

const MES_LONGO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function renderRuler() {
  const sel = $("#m-select");
  sel.innerHTML = S.months.map(m => `<option value="${m.key}">${MES_LONGO[+m.key.slice(5) - 1]} ${m.key.slice(0, 4)}</option>`).join("");
  sel.value = month;
  const i = S.months.findIndex(m => m.key === month);
  $("#m-prev").disabled = i <= 0;
  $("#m-next").disabled = i >= S.months.length - 1;
}
$("#m-select").onchange = e => { month = e.target.value; render(); };
const stepMonth = d => { const i = S.months.findIndex(m => m.key === month) + d; if (S.months[i]) { month = S.months[i].key; render(); } };
$("#m-prev").onclick = () => stepMonth(-1);
$("#m-next").onclick = () => stepMonth(1);

function renderReserve() {
  const p = S.per_month[month];
  const gasto = p.vida + p.cartoes + p.compromissos;
  const idx = S.months.findIndex(m => m.key === month);
  const prevKey = idx > 0 ? S.months[idx - 1].key : null;
  const prev = prevKey ? S.per_month[prevKey] : null;
  const [int, ct] = brl(gasto).split(",");
  const dg = prev ? gasto - (prev.vida + prev.cartoes + prev.compromissos) : 0;
  const delta = prev ? `${dg > 0 ? "▲" : "▼"} ${rs(Math.abs(dg), false)} vs ${label(prevKey)}` : "";

  $("#reserve").innerHTML = `
    <div class="k"><span>Spending · ${MES_LONGO[+month.slice(5) - 1]}</span><span class="delta">${delta}</span></div>
    <p class="label">You spend <em>this month</em></p>
    <div class="big"><span class="rs">R$</span>${int}<span class="ct">,${ct}</span></div>
    <div class="sub"><span>fixed ${rs(p.vida, false)}</span><span>cards ${rs(p.cartoes, false)}</span><span>commitments ${rs(p.compromissos, false)}</span></div>`;

  const closed = p.realizado != null;
  const v = closed ? p.realizado : p.reserva;
  const [si, sc] = brl(Math.abs(v)).split(",");
  const save = $("#save");
  save.classList.toggle("neg", v < 0);
  save.innerHTML = `
    <div class="save-l"><span class="mono">${closed ? "Savings · actual" : v < 0 ? "Short" : "Savings · forecast"}</span><span class="label">${
      closed ? "you <em>actually</em> saved" : v < 0 ? "in the red <em>this month</em>" : "you save <em>this month</em>"}</span></div>
    <div class="save-v"><span class="rs">${v < 0 ? "−R$" : "R$"}</span>${si}<span class="ct">,${sc}</span></div>`;
}

function renderFlow() {
  const p = S.per_month[month];
  const res = Math.max(0, p.reserva);
  const tot = p.vida + p.cartoes + p.compromissos + res || 1;
  const parts = [
    ["Fixed costs", p.vida, "seg-vida"],
    ["Cards", p.cartoes, "seg-cart"],
    ["Commitments", p.compromissos, "seg-comp"],
    ["Savings", res, "seg-res"],
  ];
  $("#flow").innerHTML = `
    <div class="sec-head"><span class="dia">◇</span> Where your income goes <span class="dots"></span>${label(month)}</div>
    <div class="stack">${parts.map(([n, v, c]) => `<div class="${c}" style="flex-basis:${(v / tot) * 100}%" title="${n}"></div>`).join("")}</div>
    <div class="rows">
      ${parts.map(([n, v, c]) => `<div class="r"><span class="sw ${c}"></span><span class="nm">${n}</span><span class="dots"></span>
        <span class="v">${col(v)}</span><span class="pc">${Math.round((v / tot) * 100)}%</span></div>`).join("")}
      <div class="r total"><span class="nm">Income</span><span class="dots"></span><span class="v">${col(p.receitas)}</span><span class="pc"></span></div>
    </div>`;
}

// faixa de cor da reserva: rosa até 3 mil, amarelo entre 3 e 5 mil, verde a partir de 5 mil
const tier = v => v < 0 ? "neg" : v < 3000 ? "t-low" : v < 5000 ? "t-mid" : "t-high";

function renderChart() {
  const ks = S.months.map(m => m.key);
  const proj = ks.map(k => S.per_month[k].reserva);
  const real = ks.map(k => S.per_month[k].realizado);
  const vals = ks.map((k, i) => real[i] ?? proj[i]);
  const W = Math.max(280, $("#chart").clientWidth || 1000), H = 230, top = 22, bot = 26;

  // celular: uma linha por mês, valor sempre visível
  if (W < 600) {
    const maxAbs = Math.max(...vals.map(Math.abs), ...proj.map(Math.abs), 1);
    const pct = v => Math.max(1.5, Math.abs(v) / maxAbs * 100);
    $("#chart").innerHTML = `<div class="hbars">${ks.map((k, i) => {
      const v = vals[i], closed = real[i] != null, d = closed ? real[i] - proj[i] : 0;
      return `<button class="hrow ${tier(v)} ${k === month ? "on" : ""} ${closed ? "closed" : ""}" data-m="${k}">
        <span class="m">${label(k).toUpperCase()}${closed ? `<small>actual</small>` : ""}</span>
        <span class="track"><i style="width:${pct(v)}%"></i>${closed ? `<s style="left:${pct(proj[i])}%" title="forecast ${rs(proj[i], false)}"></s>` : ""}</span>
        <span class="val">${col(v, false)}${closed ? `<small class="${d >= 0 ? "up" : "down"}">${signed(d)}</small>` : ""}</span></button>`;
    }).join("")}</div>${closeAction()}`;
    $$(".hrow").forEach(b => b.onclick = () => { month = b.dataset.m; render(); });
    bindCloseAction();
    return;
  }
  const max = Math.max(...vals, ...proj, 0), min = Math.min(...vals, ...proj, 0);
  const span = (max - min) || 1;
  const y = v => top + (max - v) / span * (H - top - bot);
  const step = W / ks.length, bw = Math.min(46, step * .56);
  const grid = [0.25, 0.5, 0.75, 1].map(f => max * f).filter(v => v > 0)
    .map(v => `<line class="gl" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join("");
  const bars = ks.map((k, i) => {
    const v = vals[i], x = i * step + (step - bw) / 2, y0 = y(0), yv = y(v);
    const h = Math.max(1, Math.abs(yv - y0));
    const ty = v >= 0 ? yv - 7 : yv + 14;
    const tx = Math.min(Math.max(x + bw / 2, 22), W - 22);
    return `<g class="bar ${tier(v)} ${k === month ? "on" : ""}" data-m="${k}">
      <rect x="${i * step}" y="0" width="${step}" height="${H}" fill="transparent"/>
      <rect class="b" x="${x}" y="${v >= 0 ? yv : y0}" width="${bw}" height="${h}"/>
      ${real[i] != null ? `<line class="ghost-l" x1="${x - 4}" x2="${x + bw + 4}" y1="${y(proj[i])}" y2="${y(proj[i])}"/>` : ""}
      <text class="val" x="${tx}" y="${ty}" text-anchor="middle">${rs(v, false)}</text>
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" ${step < 50 ? `style="font-size:9px"` : ""}>${(step < 60 ? MES[+k.slice(5) - 1] : label(k)).toUpperCase()}</text></g>`;
  }).join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings by month">
    <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="${css("--rust")}" stroke-width="1.4"/></pattern></defs>
    ${grid}${bars}<line class="base" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
  $("#chart").insertAdjacentHTML("beforeend", closeAction());
  bindCloseAction();
  const svg = $("#chart svg");
  $$(".bar", svg).forEach(g => g.onclick = () => { month = g.dataset.m; render(); });
}

function renderFixed() {
  const items = S.vida.map(i => ({ ...i, v: i.values[month] || 0 }));
  const tot = items.reduce((a, i) => a + i.v, 0);
  const comp = S.compromissos.map(i => ({ ...i, v: i.values[month] || 0 })).filter(i => i.v);
  const clean = s => s.split("•")[0].trim();
  const tag = s => (s.split("•")[1] || "").trim();
  $("#fixed").innerHTML = `
    <div class="sec-head"><span class="dia">◇</span> Living expenses <span class="dots"></span>${label(month)}</div>
    <div class="ttl"><h2>Fixed costs</h2><span class="v"><small class="rs-s">R$</small>${brl(tot)}</span></div>
    <div class="cap">${items.filter(i => i.v).length} items · tap one to change it</div>
    <div class="blocks">${items.filter(i => i.v).sort((a, b) => b.v - a.v).map(i => `<div style="flex:${i.v}" title="${clean(i.label)}"></div>`).join("")}</div>
    ${items.map(i => `<button class="fx-item ${i.v ? "" : "zero"}" data-row="${i.row}">
        <span class="nm">${clean(i.label)}</span>${tag(i.label) ? `<span class="tag">${tag(i.label)}</span>` : ""}
        <span class="dots"></span><span class="v">${col(i.v)}</span></button>`).join("")}
    <button class="ghost" id="add-fixed">+ Add a fixed cost</button>
    ${comp.length ? `<div class="comp"><div class="sec-head"><span class="dia">◇</span> Commitments outside cards <span class="dots"></span>${rs(comp.reduce((a, i) => a + i.v, 0))}</div>
      ${comp.map(i => `<div class="r"><span class="nm">${clean(i.label)}</span><span class="dots"></span><span class="v">${col(i.v)}</span></div>`).join("")}</div>` : ""}`;
  $$(".fx-item").forEach(b => b.onclick = () => openFixedEdit(S.vida.find(i => i.row === +b.dataset.row)));
  $("#add-fixed").onclick = () => openExpense("fixed");
}

function nextClose(card) {
  const t = new Date(S.today + "T12:00");
  let d = new Date(t.getFullYear(), t.getMonth(), card.close, 12);
  if (t.getDate() >= card.close) d = new Date(t.getFullYear(), t.getMonth() + 1, card.close, 12);
  return { date: d, days: Math.round((d - t) / 864e5) };
}

// grade 4×3: um mês por forma, a partir do mês escolhido; a forma cheia cresce com o valor da fatura
const SHAPE = { inter: "circle", nu_pf: "square", nu_pj: "diamond", bradesco: "round" };
function shapeSvg(kind, cx, cy, r, filled) {
  const a = filled ? `fill="currentColor"` : `fill="none" stroke="currentColor" stroke-width="1.3"`;
  if (kind === "circle") return `<circle cx="${cx}" cy="${cy}" r="${r}" ${a}/>`;
  if (kind === "diamond") return `<rect x="${cx - r * .78}" y="${cy - r * .78}" width="${r * 1.56}" height="${r * 1.56}" transform="rotate(45 ${cx} ${cy})" ${a}/>`;
  const rx = kind === "round" ? r * .45 : 0;
  return `<rect x="${cx - r * .9}" y="${cy - r * .9}" width="${r * 1.8}" height="${r * 1.8}" rx="${rx}" ${a}/>`;
}
function monthGrid(k, c) {
  const i0 = S.months.findIndex(m => m.key === month);
  const ms = Array.from({ length: 12 }, (_, i) => S.months[i0 + i]?.key || null);
  const max = Math.max(...S.months.map(m => c.totals[m.key] || 0), 1);
  const R = 10, step = 26;
  const cells = ms.map((m, i) => {
    const cx = 13 + (i % 4) * step, cy = 13 + Math.floor(i / 4) * step;
    if (!m) return shapeSvg(SHAPE[k], cx, cy, R, false).replace("<", `<g opacity=".25"><`) + "</g>";
    const v = c.totals[m] || 0;
    const r = v > 0 ? Math.max(2.5, R * Math.sqrt(v / max)) : 0;
    return `<g><title>${label(m)}: R$ ${brl(v)}</title>${shapeSvg(SHAPE[k], cx, cy, R, false)}${r ? shapeSvg(SHAPE[k], cx, cy, r, true) : ""}</g>`;
  }).join("");
  return `<svg class="grid" viewBox="0 0 104 78" role="img" aria-label="Bill over the next 12 months">${cells}</svg>`;
}

function renderCards() {
  const total = CARD_ORDER.reduce((a, k) => a + (S.cards[k].totals[month] || 0), 0);
  const i0 = S.months.findIndex(m => m.key === month);
  const next = S.months.slice(i0 + 1, i0 + 4).map(m => m.key);
  $("#cards").innerHTML = `
    <div class="sec-head"><span class="dia">◇</span> Bills <span class="dots"></span>${label(month)}</div>
    ${CARD_ORDER.map(k => `<button type="button" class="band" data-k="${k}" aria-label="See ${SHORT[k]} expenses" style="--share:${total ? ((S.cards[k].totals[month] || 0) / total * 100).toFixed(1) : 0}%">
        <h3>${SHORT[k]}</h3><div class="v"><small>R$</small>${brl(S.cards[k].totals[month] || 0)}<span class="chev" aria-hidden="true">›</span></div>
      </button>`).join("")}
    <p class="cards-hint mono">tap a card to see and delete expenses</p>`;
  $$("#cards .band").forEach(b => b.onclick = () => openCard(b.dataset.k));
  // projeção: bloco separado, discreto
  const pj = $("#proj");
  pj.hidden = !next.length;
  if (!next.length) return;
  pj.innerHTML = `
    <div class="sec-head"><span class="dia">◇</span> Next months <span class="dots"></span></div>
    <table class="proj-t">
      <thead><tr><th></th>${next.map(m => `<th>${label(m)}</th>`).join("")}</tr></thead>
      <tbody>${CARD_ORDER.map(k => `<tr><td>${SHORT[k]}</td>${next.map(m => `<td>${col(S.cards[k].totals[m] || 0, false)}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${next.map(m => `<td>${col(CARD_ORDER.reduce((a, k) => a + (S.cards[k].totals[m] || 0), 0), false)}</td>`).join("")}</tr></tfoot>
    </table>`;
}

// ---------------------------------------------------------------- despesas de um cartão (ver e excluir)
let CD = null;   // { card, month }
async function openCard(k) {
  CD = { card: k, month };
  $("#cd-head").textContent = `${SHORT[k]} · ${label(month)} bill`;
  $("#cd-title").innerHTML = `${SHORT[k]} <em>${MES_LONGO[+month.slice(5) - 1]}</em>`;
  $("#cd-total").innerHTML = "";
  $("#cd-list").innerHTML = `<p class="note">Loading…</p>`;
  if (!$("#dlg-card").open) $("#dlg-card").showModal();
  try {
    const r = await api(`/api/expenses?card=${k}&month=${month}`);
    renderCardList(r);
  } catch (e) { $("#cd-list").innerHTML = `<p class="warn">${e.message}</p>`; }
}

function renderCardList(r) {
  $("#cd-total").innerHTML = `<span class="mono">${r.items.length} ${r.items.length === 1 ? "expense" : "expenses"}</span>${col(r.total)}`;
  if (!r.items.length) { $("#cd-list").innerHTML = `<p class="note">No expenses on this bill.</p>`; return; }
  const kind = it => {
    const t = (it.type || "").toLowerCase();
    if (t.startsWith("recorrente")) return "monthly";
    if (t.startsWith("parcelada") && it.last !== CD.month) return `installments · until ${label(it.last)}`;
    if (t.startsWith("parcelada")) return "last installment";
    return "one-time";
  };
  $("#cd-list").innerHTML = r.items.map((it, i) => `
    <div class="cd-row" data-i="${i}">
      <div class="cd-main"><span class="cd-name">${it.label.replace(/</g, "&lt;")}</span><span class="cd-kind mono">${kind(it)}</span></div>
      <span class="cd-v">${col(it.value)}</span>
      <button type="button" class="cd-del" aria-label="Delete ${it.label.replace(/"/g, "")}">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>`).join("");
  $$("#cd-list .cd-row").forEach(row => {
    const it = r.items[+row.dataset.i];
    $(".cd-del", row).onclick = () => confirmDelete(row, it);
  });
}

// confirmação na própria linha, dizendo o que vai sair da planilha
function confirmDelete(row, it) {
  const many = (it.type || "").toLowerCase().startsWith("parcelada") || (it.type || "").toLowerCase().startsWith("recorrente");
  row.classList.add("confirm");
  row.innerHTML = `<p class="cd-q">Delete <b>${it.label.replace(/</g, "&lt;")}</b> from the spreadsheet?${many ? " The whole purchase goes, with all its months." : ""}</p>
    <div class="cd-actions"><button type="button" class="cd-no">Cancel</button><button type="button" class="cd-yes">Delete</button></div>`;
  $(".cd-no", row).onclick = () => openCard(CD.card);
  $(".cd-yes", row).onclick = async () => {
    const name = it.label.split(" — ")[0];
    // resposta imediata: some da lista e o total da fatura já desconta
    row.classList.add("leaving");
    setTimeout(() => row.remove(), 220);
    const tot = $("#cd-total .money .amt");
    if (tot) tot.textContent = brl(Math.max(0, parseAmount(tot.textContent) - it.value));
    toast(`Deleting ${name}…`);
    const { card, month: m } = CD;
    try {
      const r = await write("/api/delete", { token: it.token, card, month: m });
      await refresh(r);
      if (r && r.list && $("#dlg-card").open && CD.card === card) renderCardList(r.list);
      else if ($("#dlg-card").open) await openCard(card);
      toast(`Deleted: ${name}`);
    } catch (e) { alert("Couldn't delete: " + e.message); if ($("#dlg-card").open) openCard(card); }
  };
}

// ---------------------------------------------------------------- nova despesa
const F = { where: null, autoWhere: null, userPicked: false, n: 1 };

function openExpense(mode) {
  const f = $("#form-expense");
  f.reset();
  Object.assign(F, { where: mode === "fixed" ? "fixed" : null, autoWhere: null, userPicked: mode === "fixed", n: 1 });
  $("#f-date").value = S.today;
  $("#f-recog").hidden = true;
  const opts = S.months.map(m => `<option value="${m.key}">${label(m.key)}</option>`).join("");
  $("#f-start").innerHTML = opts;
  $("#f-start").value = month;
  $("#f-end").innerHTML = `<option value="">no end</option>` + opts;
  renderWhere(); renderSteps(); updateMode(); preview();
  $("#dlg-expense").showModal();
  setTimeout(() => $("#f-amount").focus(), 50);
}

function renderWhere() {
  const btn = (k, name, sub, bg, light) => `<button type="button" data-k="${k}" class="${F.where === k ? "on" : ""}"
     style="--sel:${bg};--sel-t:var(--bg)">
     ${F.autoWhere === k && !F.userPicked ? `<span class="auto">◆ auto</span>` : ""}<span>${name}</span><span class="d">${sub}</span></button>`;
  $("#f-where").innerHTML = CARD_ORDER.map(k => btn(k, SHORT[k], `closes ${S.cards[k].close}`, `var(--brand-${k})`, LIGHT_TEXT[k])).join("")
    + btn("fixed", "Fixed cost", "monthly", "var(--cobalt)", true);
  $$("#f-where button").forEach(b => b.onclick = () => { F.where = b.dataset.k; F.userPicked = true; renderWhere(); updateMode(); preview(); });
}

function updateMode() {
  const fixed = F.where === "fixed";
  $("#card-fields").hidden = fixed;
  $("#fixed-fields").hidden = !fixed;
  $("#f-amount-hint").textContent = fixed ? "amount per month" : ($("#f-recurring").checked ? "amount per month" : "total amount");
  $("#f-submit").textContent = fixed ? "Add fixed cost" : "Add to spreadsheet";
}

function renderSteps() {
  $("#p-val").textContent = `${F.n}×`;
  $("#p-chips").innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map(n => `<button type="button" class="${n === F.n ? "on" : ""}" data-n="${n}">${n}×</button>`).join("");
  $$("#p-chips button").forEach(b => b.onclick = () => { F.n = +b.dataset.n; renderSteps(); preview(); });
  const rec = $("#f-recurring").checked;
  $(".stepper").style.opacity = rec ? .35 : 1;
}
$("#p-minus").onclick = () => { F.n = Math.max(1, F.n - 1); renderSteps(); preview(); };
$("#p-plus").onclick = () => { F.n = Math.min(48, F.n + 1); renderSteps(); preview(); };
$("#f-recurring").onchange = () => { renderSteps(); updateMode(); preview(); };
["#f-amount", "#fx-amount"].forEach(s => $(s).addEventListener("input", e => {
  const c = e.target.value.replace(/[^\d.,]/g, "");
  if (c !== e.target.value) e.target.value = c;
}));
["#f-amount", "#f-date", "#f-start", "#f-end"].forEach(s => $(s).addEventListener("input", () => preview()));

let pvTimer, pvSeq = 0;
function preview() {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(doPreview, 120);
  validate();
}
async function doPreview() {
  const el = $("#f-preview");
  const amount = parseAmount($("#f-amount").value);
  if (!F.where) { el.innerHTML = `<div class="when mute">Pick a card or fixed cost.</div>`; return; }
  if (F.where === "fixed") {
    const s = $("#f-start").value, e = $("#f-end").value;
    el.innerHTML = `<div class="when"><b>${rs(amount)}</b> a month in Living expenses, from <b>${label(s)}</b> ${e ? `to <b>${label(e)}</b>` : "onward"}.</div>`;
    return;
  }
  const seq = ++pvSeq;
  try {
    const p = await api("/api/preview", { card: F.where, amount: amount || 0, date: $("#f-date").value || S.today,
      installments: F.n, recurring: $("#f-recurring").checked });
    if (seq !== pvSeq) return;
    const last = S.months[S.months.length - 1].key;
    const beyond = p.items.filter(i => i.month > last).length;
    const map = Object.fromEntries(p.items.map(i => [i.month, i.value]));
    const from = S.months.findIndex(m => m.key === p.first_month);
    const show = S.months.slice(Math.max(0, from - 1), Math.max(0, from - 1) + Math.max(6, Math.min(p.items.length + 2, 13)));
    const card = S.cards[F.where];
    el.innerHTML = `<div class="when">Goes on <b>${card.name}</b>'s <b>${label(p.first_month)}</b> bill
        <span class="mono">closes ${ddmm(p.close_date)} · due ${ddmm(p.due_date)}${p.items.length > 1 ? ` · ${p.items.length}× of ${rs(p.items[p.items.length - 1].value)}` : ""}</span></div>
      <div class="tl">${show.map(m => `<div class="${map[m.key] ? "has" : ""}">${label(m.key)}<b>${map[m.key] ? rs(map[m.key], false) : "—"}</b></div>`).join("")}</div>
      ${beyond ? `<div class="warn">${beyond} installment(s) after ${label(last)}: they go on the card's tab but stay out of the monthly overview.</div>` : ""}`;
  } catch (e) { el.innerHTML = `<div class="warn">${e.message}</div>`; }
}

function validate() {
  const ok = parseAmount($("#f-amount").value) > 0 && $("#f-desc").value.trim() && F.where;
  $("#f-submit").disabled = !ok;
}

// reconhecimento do cartão pela descrição
let sgTimer;
$("#f-desc").addEventListener("input", () => {
  validate();
  clearTimeout(sgTimer);
  sgTimer = setTimeout(async () => {
    const q = $("#f-desc").value.trim();
    const box = $("#f-recog");
    if (q.length < 2) { box.hidden = true; return; }
    const hits = await api("/api/suggest?q=" + encodeURIComponent(q)).catch(() => []);
    if (!hits.length) { box.hidden = true; F.autoWhere = null; renderWhere(); return; }
    const top = hits[0];
    F.autoWhere = top.card;
    if (!F.userPicked) { F.where = top.card; renderWhere(); updateMode(); preview(); }
    box.hidden = false;
    box.innerHTML = `<span class="tip">Recognized: ${top.label} usually goes on <b>${S.cards[top.card].name}</b> (${top.count}×)</span>`
      + hits.slice(0, 4).map(h => `<button type="button" data-k="${h.card}" data-l="${h.label}"><i style="background:var(--t-${h.card})"></i>${h.label} · ${S.cards[h.card].name}</button>`).join("");
    $$("button", box).forEach(b => b.onclick = () => {
      $("#f-desc").value = b.dataset.l; F.where = b.dataset.k; F.userPicked = true; renderWhere(); updateMode(); preview();
    });
  }, 160);
});

$("#form-expense").addEventListener("submit", async ev => {
  ev.preventDefault();
  const btn = $("#f-submit");
  btn.disabled = true; btn.textContent = "Saving…";
  const amount = parseAmount($("#f-amount").value);
  const desc = $("#f-desc").value.trim();
  try {
    let r, msg;
    if (F.where === "fixed") {
      r = await write("/api/fixed", { label: desc, amount, start: $("#f-start").value, end: $("#f-end").value || null });
      msg = `${desc} added to fixed costs · ${rs(amount)}/mo`;
    } else {
      const rec = $("#f-recurring").checked;
      r = await write("/api/expense", { description: desc, amount, date: $("#f-date").value || S.today, card: F.where, installments: F.n, recurring: rec });
      const it = r.schedule.items;
      msg = `${S.cards[F.where].name} · ${rec ? "monthly" : it.length > 1 ? `${it.length}× ${rs(it[it.length - 1].value)}` : rs(amount)} · ${label(r.schedule.first_month)} bill`;
    }
    $("#dlg-expense").close();
    await refresh(r);
    toast(msg, r.undo);
  } catch (e) { alert(e.message); }
  finally { updateMode(); validate(); }
});

// ---------------------------------------------------------------- custo fixo: editar
let FX = null;
function openFixedEdit(item) {
  FX = item;
  $("#fx-title").textContent = item.label.split("•")[0].trim();
  $("#fx-amount").value = brl(item.values[month] || 0);
  $("#fx-start").innerHTML = S.months.map(m => `<option value="${m.key}">${label(m.key)}</option>`).join("");
  $("#fx-start").value = month;
  $("#dlg-fixed").showModal();
}
$("#form-fixed").addEventListener("submit", async ev => {
  ev.preventDefault();
  try {
    const r = await write("/api/fixed/update", { row: FX.row, label: FX.label, amount: parseAmount($("#fx-amount").value), start: $("#fx-start").value });
    $("#dlg-fixed").close();
    await refresh(r);
    toast(`${$("#fx-title").textContent} updated from ${label($("#fx-start").value)}`);
  } catch (e) { alert(e.message); }
});

// ---------------------------------------------------------------- ajustes
$("#btn-settings").onclick = () => {
  $("#set-rows").innerHTML = CARD_ORDER.map(k => `<div class="set-row" data-k="${k}">
    <span class="nm"><i style="background:var(--t-${k})"></i>${S.cards[k].name}</span>
    <label class="field"><span class="lab mono">Closes on</span><input class="in" type="number" min="1" max="31" name="close" value="${S.cards[k].close}"></label>
    <label class="field"><span class="lab mono">Due on</span><input class="in" type="number" min="1" max="31" name="due" value="${S.cards[k].due}"></label></div>`).join("");
  $("#dlg-settings").showModal();
};
$("#form-settings").addEventListener("submit", async ev => {
  ev.preventDefault();
  const cards = {};
  $$(".set-row").forEach(r => cards[r.dataset.k] = { close: +$("[name=close]", r).value, due: +$("[name=due]", r).value });
  try { await api("/api/config", { cards }); $("#dlg-settings").close(); await load(true); toast("Card dates saved"); }
  catch (e) { alert(e.message); }
});

$$("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());
$$("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
$("#fab").onclick = () => openExpense();

// ---------------------------------------------------------------- fechar o mês
const curMonth = () => S.today.slice(0, 7);
const ended = k => k < curMonth();          // o mês do calendário já acabou
const closable = k => k <= curMonth();      // dá para fechar o mês corrente antes do fim, se quiser

// botão no fim da lista da Reserva, para o mês selecionado
function closeAction() {
  if (!closable(month)) return `<p class="close-hint mono">${label(month)} hasn't started · you can close it from the current month on</p>`;
  const closed = S.per_month[month].realizado != null;
  return `<button class="ghost close-btn" type="button">${closed ? `Edit actual for ${label(month)}` : `Close ${label(month)}: enter what I saved`}</button>`;
}
function bindCloseAction() { const b = $("#chart .close-btn"); if (b) b.onclick = () => openClose(month); }

// aviso no Início: o mês mais antigo que já acabou e ainda não foi fechado
function renderClosePrompt() {
  const el = $("#close-prompt");
  const k = S.months.map(m => m.key).find(k => ended(k) && S.per_month[k].realizado == null);
  el.hidden = !k;
  if (!k) return;
  el.innerHTML = `<div><span class="mono">◇ Close the month</span><p><b>${MES_LONGO[+k.slice(5) - 1]} is over.</b> How much did you actually save?</p></div>
    <button type="button" class="cp-btn">Enter</button>`;
  $(".cp-btn", el).onclick = () => openClose(k);
}

let CL = null;
function openClose(k) {
  CL = k;
  const p = S.per_month[k];
  $("#cl-title").textContent = `${MES_LONGO[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
  $("#cl-proj").innerHTML = `The forecast was <b>R$ ${brl(p.reserva)}</b>.`;
  $("#cl-amount").value = p.realizado != null ? brl(p.realizado) : "";
  $("#cl-reopen").hidden = p.realizado == null;
  $("#dlg-close").showModal();
  setTimeout(() => $("#cl-amount").focus(), 50);
}
$("#cl-amount").addEventListener("input", e => { const c = e.target.value.replace(/[^\d.,-]/g, ""); if (c !== e.target.value) e.target.value = c; });
$("#form-close").addEventListener("submit", async ev => {
  ev.preventDefault();
  const raw = $("#cl-amount").value.trim();
  if (!raw) return;
  const amount = parseAmount(raw);
  try {
    const r = await write("/api/close", { month: CL, amount });
    $("#dlg-close").close();
    await refresh(r);
    const d = amount - S.per_month[CL].reserva;
    toast(`${label(CL)} closed · R$ ${brl(amount)} (${signed(d)} vs forecast)`);
  } catch (e) { alert(e.message); }
});
$("#cl-reopen").onclick = async () => {
  try { const r = await write("/api/close", { month: CL, amount: null }); $("#dlg-close").close(); await refresh(r); toast(`${label(CL)} reopened`); }
  catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------- título das páginas
function renderPageTitle() {
  const el = $("#page-title");
  el.hidden = !S;
  if (el.hidden) return;
  $(".pt-v", el).hidden = view === "inicio";
  if (view === "inicio") {   // saudação no topo do Início
    $("h1", el).innerHTML = `Hey, <em>${USER_NAME}</em>`;
    $(".pt-cap", el).textContent = "Here's your personal finance dashboard";
    return;
  }
  const money = v => { const [i, c] = brl(Math.abs(v)).split(","); return `<span class="rs">${v < 0 ? "−R$" : "R$"}</span>${i}<span class="ct">,${c}</span>`; };
  if (view === "reserva") {
    const ks = S.months.map(m => m.key);
    const closedKs = ks.filter(k => S.per_month[k].realizado != null);
    const realSum = closedKs.reduce((a, k) => a + S.per_month[k].realizado, 0);
    const forecast = ks.reduce((a, k) => a + (S.per_month[k].realizado ?? S.per_month[k].reserva), 0);
    $("h1", el).innerHTML = `Savings <em>month by month</em>`;
    if (closedKs.length) {
      $(".pt-v", el).innerHTML = money(realSum);
      $(".pt-cap", el).textContent = `actually saved (${closedKs.length} ${closedKs.length > 1 ? "months closed" : "month closed"}) · forecast to ${label(ks[ks.length - 1])}: R$ ${brl(forecast, false)}`;
    } else {
      $(".pt-v", el).innerHTML = money(forecast);
      $(".pt-cap", el).textContent = `forecast ${label(ks[0])} to ${label(ks[ks.length - 1])} · no month closed yet`;
    }
  } else {
    const total = CARD_ORDER.reduce((a, k) => a + (S.cards[k].totals[month] || 0), 0);
    $("h1", el).innerHTML = `Credit <em>cards</em>`;
    $(".pt-v", el).innerHTML = money(total);
    $(".pt-cap", el).textContent = `${MES_LONGO[+month.slice(5) - 1]} bills`;
  }
}

// ---------------------------------------------------------------- menu / telas
const VIEWS = ["inicio", "reserva", "cartoes"];
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
function go(v, push = true) {
  view = v;
  $$(".view").forEach(el => el.hidden = el.dataset.view !== v);
  $$(".tabbar [data-go]").forEach(b => {
    b.classList.toggle("on", b.dataset.go === v);
    b.setAttribute("aria-current", b.dataset.go === v ? "page" : "false");
  });
  $(".monthbar").hidden = v === "reserva";   // o gráfico já mostra todos os meses
  renderPageTitle();
  if (push && location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
  if (S && v === "reserva") renderChart();     // precisa da largura visível para desenhar
  window.scrollTo(0, 0);
}
$$(".tabbar [data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && v !== view) go(v, false); });
go(view, false);

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg, undoToken) {
  const t = $("#toast");
  const busy = msg.endsWith("…");          // em andamento: mostra um girador no lugar do ✓
  const ms = undoToken ? 9000 : 3500;
  t.innerHTML = `<span class="t-ico ${busy ? "busy" : ""}">${busy ? "" : `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>`}</span>
    <span class="t-msg">${msg}</span>${undoToken ? `<button type="button">Undo</button>` : ""}
    ${busy ? "" : `<i class="t-bar" style="animation-duration:${ms}ms"></i>`}`;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";   // reinicia a entrada a cada aviso
  clearTimeout(toastTimer);
  if (!busy) toastTimer = setTimeout(() => t.hidden = true, ms);
  if (undoToken) $("button", t).onclick = async () => {
    t.hidden = true;
    try { const r = await write("/api/undo", { token: undoToken }); await refresh(r); toast("Undone. The row was removed from the spreadsheet."); }
    catch (e) { alert(e.message); }
  };
}

// ---------------------------------------------------------------- carga + espelho
function applyState(st) {
  lastMtime = st.mtime;
  S = st;
  if (!month || !S.per_month[month]) month = S.default_month;
  render();
}

// depois de gravar: se a resposta já trouxe os números (versão Google), usa direto; senão relê
async function refresh(r) {
  if (r && r.state) applyState(r.state);
  else await load(true);
}

async function load(force) {
  const sync = $("#sync");
  try {
    const st = await api("/api/state");
    sync.className = "sync";
    $("span", sync).textContent = st.excel_open ? "open in Excel" : "spreadsheet synced";
    if (st.excel_open) sync.className = "sync stale";
    if (!force && st.mtime === lastMtime && S) { S.excel_open = st.excel_open; return; }
    applyState(st);
  } catch (e) {
    sync.className = "sync err";
    $("span", sync).textContent = "offline";
    // sem chave, a própria tela de chave já explica o que fazer
    if (e && /app key|chave do app/i.test(e.message)) return;
    // mostra o motivo na tela, em vez de deixar o app parado sem dados
    const b = $("#banner");
    b.hidden = false;
    b.textContent = "Couldn't read the spreadsheet: " + (e && e.message ? e.message : e);
  }
}

load(true);
let rzTimer;
window.addEventListener("resize", () => { clearTimeout(rzTimer); rzTimer = setTimeout(() => S && renderChart(), 120); });
// relê a planilha de tempos em tempos: se você editar no Excel, o app acompanha
setInterval(() => { if (!document.hidden && !$("dialog[open]")) load(false); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { load(false); checkUpdate(); } });

// ---------------------------------------------------------------- versão nova do site
// O ícone na tela do iPhone guarda a página antiga por um tempo. Aqui o app pergunta ao site
// qual é a versão publicada e, se for outra, recarrega sozinho (nunca com um formulário aberto).
const APP_VERSION = "d99bc45bd5";   // o build do site troca pela versão publicada
async function checkUpdate() {
  if (APP_VERSION.startsWith("__") || document.hidden || $("dialog[open]")) return;   // app local, ou em uso
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    const { v } = await r.json();
    if (!v || v === APP_VERSION) return;
    if (new URLSearchParams(location.search).get("v") === v) return;   // já recarregou para ela; não insiste
    location.replace(location.pathname + "?v=" + v + location.hash);   // endereço novo: o iPhone não usa a cópia guardada
  } catch (e) { /* sem internet: tenta de novo depois */ }
}
checkUpdate();
setInterval(checkUpdate, 60000);
