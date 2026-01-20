// public/app.js (JSON ile gönderim + varsayılan miktarlar doğru)

function fmtMoney(x) {
  const n = Math.round(x * 100) / 100;
  return n.toFixed(2).replace(".", ",") + " €";
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}

const itemsWrap = document.getElementById("items");
const addBtn = document.getElementById("addItemBtn");
const grandEl = document.getElementById("grandTotal");
const itemsJsonEl = document.getElementById("itemsJson");

let rowId = 0;
const rows = new Map();

function productByCode(code) {
  return (window.PRODUCTS || []).find((p) => p.code === code);
}

function optionHTML() {
  return (window.PRODUCTS || [])
    .map((p) => {
      const priceText = p.unit === "kg" ? `${p.unitPrice} €/kg` : `${p.unitPrice} €/paket`;
      return `<option value="${p.code}">${p.name} • ${priceText}</option>`;
    })
    .join("");
}

function clampQty(p, raw) {
  let q = Number(raw);

  // boş/NaN -> 0
  if (!Number.isFinite(q)) q = 0;

  // negatif olmasın
  if (q < 0) q = 0;

  // step uygula (kg: 0.5, paket: 1)
  const step = Number(p.step || (p.unit === "paket" ? 1 : 0.5));
  q = Math.round(q / step) * step;
  q = Number(q.toFixed(3));

  // paket tam sayı olsun (ama min zorlamıyoruz)
  if (p.unit === "paket") q = Math.round(q);

  return q; // ✅ min zorlaması yok
}


function updateTotals() {
  let grand = 0;
  const payload = [];

  rows.forEach((r) => {
    const p = productByCode(r.select.value);
    if (!p) return;

    const q = clampQty(p, r.qty.value);
    r.qty.value = String(q);

    r.unitBadge.textContent = p.unit; // kg / paket

    const lt = p.unitPrice * q;
    r.lineTotal.textContent = fmtMoney(lt);
    grand += lt;

    payload.push({ code: p.code, quantity: q });
  });

  grandEl.textContent = fmtMoney(grand);

  // ✅ Tek kaynak: JSON
  if (itemsJsonEl) {
    itemsJsonEl.value = JSON.stringify(payload);
  }
}

function removeRow(id) {
  const r = rows.get(id);
  if (!r) return;
  r.row.remove();
  rows.delete(id);
  updateTotals();
}

function addRow() {
  rowId += 1;
  const id = rowId;

  const select = el("select", { class: "select" });
  select.innerHTML = optionHTML();

  const qty = el("input", { class: "qty", type: "number" });

  const unitBadge = el("span", { class: "unitBadge" }, [""]); // kg/paket
  const qtyWrap = el("div", { class: "qtyWrap" }, [qty, unitBadge]);

  const meta = el("div", { class: "muted small" });
  const lineTotal = el("div", { class: "lineTotal" }, ["0,00 €"]);

  const remove = el(
    "button",
    { type: "button", class: "btn smallbtn danger", onclick: () => removeRow(id) },
    ["Sil"]
  );

  const row = el("div", { class: "itemRow" }, [
    el("div", {}, [el("div", { class: "label" }, ["Ürün"]), select, meta]),
    el("div", {}, [el("div", { class: "label" }, ["Miktar"]), qtyWrap]),
    el("div", { class: "right" }, [el("div", { class: "label" }, ["Tutar"]), lineTotal]),
    el("div", { class: "right" }, [el("div", { class: "label" }, [" "]), remove])
  ]);

  itemsWrap.appendChild(row);

  function applyRules(resetDefault) {
    const p = productByCode(select.value);
    if (!p) return;

    qty.min = String(p.min);
    qty.step = String(p.step);
    unitBadge.textContent = p.unit;

    if (resetDefault) {
  qty.value = "0";
}


    meta.textContent =
      p.unit === "kg"
        ? `Min ${p.min} kg • Birim: ${p.unitPrice} €/kg`
        : `Min ${p.min} paket • Birim: ${p.unitPrice} €/paket`;

    updateTotals();
  }

  select.addEventListener("change", () => applyRules(true));
  qty.addEventListener("input", updateTotals);
  qty.addEventListener("blur", updateTotals);

  applyRules(true);

  rows.set(id, { row, select, qty, unitBadge, lineTotal });
}

addBtn.addEventListener("click", addRow);

// Sayfa açılınca 1 satır
addRow();
updateTotals();
const form = document.getElementById("orderForm");

if (form) {
  form.addEventListener("submit", (e) => {
    let payload = [];
    try {
      payload = JSON.parse(itemsJsonEl?.value || "[]");
    } catch {
      payload = [];
    }

    // 0 olan kalemleri tamamen çıkar (temiz sipariş)
    payload = payload.filter(it => Number(it.quantity) > 0);

    if (payload.length === 0) {
      e.preventDefault();
      alert("Lütfen en az 1 ürün için miktar girin.");
      return;
    }

    for (const it of payload) {
      const p = productByCode(it.code);
      if (!p) {
        e.preventDefault();
        alert("Geçersiz ürün seçildi.");
        return;
      }

      const q = Number(it.quantity);

      if (p.unit === "kg" && q < 5) {
        e.preventDefault();
        alert("Kırmızı et ürünlerinde minimum sipariş 5 kg olmalıdır.");
        return;
      }

      if (p.unit === "paket" && q < 1) {
        e.preventDefault();
        alert("Tavuk ürünlerinde minimum sipariş 1 paket olmalıdır.");
        return;
      }
    }

    // Temizlenmiş payload'ı tekrar yaz
    itemsJsonEl.value = JSON.stringify(payload);
  });
}

