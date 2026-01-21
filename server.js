const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");

const { db, initDb } = require("./db");
const { buildOrderPdf } = require("./pdf");
const { sendOrderEmails } = require("./mailer");

initDb();

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(
  session({
    secret: "change-this-secret",
    resave: false,
    saveUninitialized: false
  })
);

const ADMIN_USER = "admin";
const ADMIN_PASS = "120576";
const ADMIN_EMAIL = "siparis@igmg-lauffen.de";

const PRODUCTS = [
  { code: "YD_ET", name: "Genç Dana Eti", type: "red", unit: "kg", unitPrice: 13.0, min: 5, step: 0.5 },
  { code: "YD_KIYMA", name: "Genç Dana Kıyma", type: "red", unit: "kg", unitPrice: 12.0, min: 5, step: 0.5 },
  { code: "YD_KEMIK", name: "Genç Dana Kemikli Et", type: "red", unit: "kg", unitPrice: 11.0, min: 5, step: 0.5 },
  { code: "KUZU_TUM", name: "Kuzu Eti (Tüm)", type: "red", unit: "kg", unitPrice: 13.0, min: 5, step: 0.5 },

  { code: "T_BUDU", name: "Tavuk Budu (10 kg paket)", type: "chicken", unit: "paket", unitPrice: 27.0, min: 1, step: 1 },
  { code: "T_KANAT", name: "Tavuk Kanadı (10 kg paket)", type: "chicken", unit: "paket", unitPrice: 35.0, min: 1, step: 1 },
  { code: "T_GOGUS", name: "Tavuk Göğsü (5 kg paket)", type: "chicken", unit: "paket", unitPrice: 37.0, min: 1, step: 1 },
  { code: "T_INCIK", name: "Tavuk İncik (10 kg paket)", type: "chicken", unit: "paket", unitPrice: 35.0, min: 1, step: 1 }
];

function productByCode(code) {
  return PRODUCTS.find((p) => p.code === code);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.redirect("/admin/login");
}

function money(x) {
  return (Math.round(x * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

app.get("/", (req, res) => res.redirect("/siparis"));

app.get("/siparis", (req, res) => {
  res.render("index", { products: PRODUCTS });
});

app.post("/order", async (req, res) => {
  try {
    const customer_name = String(req.body.customer_name || "").trim();
    const phone = String(req.body.phone || "").trim();
    const email = String(req.body.email || "").trim() || null;
    const note = String(req.body.note || "").trim() || null;

    if (!customer_name || !phone) {
      return res.status(400).send("İsim ve telefon zorunludur.");
    }

    // ✅ JSON ile alıyoruz (tek kaynak)
    let items = [];
    try {
      items = JSON.parse(req.body.items_json || "[]");
    } catch {
      items = [];
    }
    if (!Array.isArray(items) || items.length < 1) {
      return res.status(400).send("En az 1 ürün seçmelisiniz.");
    }

    const normalizedItems = [];
    for (const it of items) {
      const code = String(it.code || "").trim();
      const p = productByCode(code);
      if (!p) {
        return res.status(400).send("Geçersiz ürün.");
      }

      let qty = Number(it.quantity);
      if (!Number.isFinite(qty)) return res.status(400).send("Geçersiz miktar.");

      // step
      qty = Math.round(qty / p.step) * p.step;
      qty = Number(qty.toFixed(3));

      // min
      if (qty < p.min) {
        return res.status(400).send(`${p.name} için minimum ${p.min} ${p.unit} sipariş verilebilir.`);
      }
      // paket tam sayı
      if (p.unit === "paket" && !Number.isInteger(qty)) {
        return res.status(400).send(`${p.name} için paket adedi tam sayı olmalıdır.`);
      }

      const lineTotal = qty * p.unitPrice;

      normalizedItems.push({
        product_code: p.code,
        product_name: p.name,
        unit_label: p.unit,
        unit_price_eur: p.unitPrice,
        quantity: qty,
        line_total_eur: lineTotal
      });
    }

    const createdAt = new Date().toISOString();
    const insertOrder = db.prepare(
      `INSERT INTO orders (customer_name, phone, email, note, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = insertOrder.run(customer_name, phone, email, note, createdAt);
    const orderId = result.lastInsertRowid;

    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_code, product_name, unit_label, unit_price_eur, quantity, line_total_eur)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction((rows) => {
      for (const r of rows) {
        insertItem.run(
          orderId,
          r.product_code,
          r.product_name,
          r.unit_label,
          r.unit_price_eur,
          r.quantity,
          r.line_total_eur
        );
      }
    });
    tx(normalizedItems);

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    const orderItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC").all(orderId);

    const pdfBuffer = await buildOrderPdf({ order, items: orderItems });

    const subject = `Yeni Sipariş #${orderId} - ${customer_name}`;
    const text = `Yeni sipariş alındı.\n\nSipariş No: ${orderId}\nİsim: ${customer_name}\nTelefon: ${phone}\n\nPDF ektedir.`;

    // Mail atmak istemezseniz aşağıdaki bloğu geçici kapatabilirsiniz.
    await sendOrderEmails({
      adminTo: ADMIN_EMAIL,
      customerTo: email || null,
      subject,
      text,
      pdfBuffer,
      pdfFilename: `siparis-${orderId}.pdf`
    });

    return res.render("success", { orderId });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Sunucu hatası: " + (e && e.message ? e.message : "Bilinmeyen hata"));
  }
});

app.get("/admin/login", (req, res) => res.render("admin-login", { error: null }));

app.post("/admin/login", (req, res) => {
  const u = String(req.body.username || "");
  const p = String(req.body.password || "");
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  return res.render("admin-login", { error: "Hatalı giriş." });
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.get("/admin", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT
        o.id AS order_id,
        o.customer_name,
        o.created_at,
        i.product_name,
        i.unit_label,
        i.quantity,
        i.line_total_eur,
        (SELECT SUM(line_total_eur) FROM order_items WHERE order_id = o.id) AS order_total
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      ORDER BY o.id DESC, i.id ASC`
    )
    .all();

  res.render("admin", { rows, money });
});

app.get("/admin/stats", requireAdmin, (req, res) => {
  const stats = db
    .prepare(
      `SELECT product_name, unit_label, SUM(quantity) AS total_qty
       FROM order_items
       GROUP BY product_name, unit_label
       ORDER BY product_name ASC`
    )
    .all();

  res.render("stats", { stats });
});

app.get("/admin/export.csv", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT
        o.id AS order_id,
        o.customer_name,
        i.product_name,
        i.quantity,
        i.unit_label,
        i.unit_price_eur,
        i.line_total_eur,
        o.created_at
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      ORDER BY o.id DESC, i.id ASC`
    )
    .all();

  // ✅ Excel için: UTF-8 BOM + noktalı virgül (DE/TR Excel)
  const bom = "\ufeff";
  const header = [
    "order_id",
    "customer_name",
    "product_name",
    "quantity",
    "unit_label",
    "unit_price_eur",
    "line_total_eur",
    "created_at"
  ];

  const lines = [header.join(";")];
  for (const r of rows) {
    const row = [
      r.order_id,
      String(r.customer_name).replaceAll(";", ","),
      String(r.product_name).replaceAll(";", ","),
      String(r.quantity).replace(".", ","),
      r.unit_label,
      String(r.unit_price_eur).replace(".", ","),
      String(r.line_total_eur).replace(".", ","),
      r.created_at
    ];
    lines.push(row.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(";"));
  }

  const csv = bom + lines.join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"siparisler.csv\"");
  res.send(csv);
});

app.post("/admin/reset", requireAdmin, (req, res) => {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM order_items").run();
    db.prepare("DELETE FROM orders").run();
  });
  tx();
  res.redirect("/admin");
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
