// pdf.js - A4 dikey uyum + stabil hizalama + Türkçe font + sadece sağ altta TOPLAM
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

function money(x) {
  const n = Math.round(Number(x || 0) * 100) / 100;
  return n.toFixed(2).replace(".", ",") + " €";
}

function safeText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function fmtQty(n) {
  const v = Math.round((Number(n || 0) * 100)) / 100;
  return String(v).replace(".", ",");
}

function assertFonts() {
  const regular = path.join(__dirname, "fonts", "DejaVuSans.ttf");
  const bold = path.join(__dirname, "fonts", "DejaVuSans-Bold.ttf");
  if (!fs.existsSync(regular)) throw new Error(`Font bulunamadı: ${regular}`);
  if (!fs.existsSync(bold)) throw new Error(`Font bulunamadı: ${bold}`);
  return { regular, bold };
}

function buildOrderPdf({ order, items }) {
  return new Promise((resolve, reject) => {
    try {
      const { regular, bold } = assertFonts();

      const doc = new PDFDocument({ size: "A4", margin: 60 });
      const chunks = [];
      doc.on("data", (d) => chunks.push(d));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      doc.registerFont("DejaVu", regular);
      doc.registerFont("DejaVuBold", bold);
      doc.font("DejaVu");

      const margin = doc.page.margins.left;
      const usableWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;

      const hline = () => {
        doc.save();
        doc.lineWidth(1);
        doc.moveTo(margin, doc.y).lineTo(margin + usableWidth, doc.y).stroke();
        doc.restore();
      };

      // Footer: sabit alt metin (istersen tamamen kaldırabiliriz)
      const footerText =
        "Siparişiniz alınmıştır.\nTeslimat günü ve saatini biz haber edeceğiz.";
      const footerFontSize = 11;

      const footerHeight = () => {
        doc.font("DejaVu").fontSize(footerFontSize);
        return doc.heightOfString(footerText, { width: usableWidth });
      };

      const footerY = () => {
        return doc.page.height - doc.page.margins.bottom - footerHeight();
      };

      const ensureSpace = (need = 80) => {
        // footer alanını koru, çakışmasın
        const bottomLimit = footerY() - 12;
        if (doc.y + need > bottomLimit) {
          doc.addPage();
          doc.font("DejaVu");
        }
      };

      // ===== HEADER =====
      doc
        .font("DejaVuBold")
        .fontSize(18)
        .text("Aytaç'tan Helal Et Siparişi", margin, doc.y, {
          width: usableWidth,
          align: "center",
        });

      doc.moveDown(0.8);
      doc.font("DejaVu").fontSize(11);

      doc.text(`Sipariş No: ${safeText(order?.id)}`, margin, doc.y, {
        width: usableWidth,
      });
      doc.text(`Tarih: ${safeText(order?.created_at)}`, margin, doc.y, {
        width: usableWidth,
      });

      doc.moveDown(0.6);
      doc.font("DejaVuBold").text("Müşteri Bilgileri", margin, doc.y, {
        width: usableWidth,
        underline: true,
      });

      doc.font("DejaVu").moveDown(0.4);
      doc.text(`İsim Soyisim: ${safeText(order?.customer_name)}`, margin, doc.y, {
        width: usableWidth,
      });
      doc.text(`Telefon: ${safeText(order?.phone)}`, margin, doc.y, {
        width: usableWidth,
      });
      if (order?.email)
        doc.text(`E-posta: ${safeText(order?.email)}`, margin, doc.y, {
          width: usableWidth,
        });
      if (order?.note)
        doc.text(`Not: ${safeText(order?.note)}`, margin, doc.y, {
          width: usableWidth,
        });

      doc.moveDown(0.8);
      hline();
      doc.moveDown(0.8);

      // ===== TABLO BAŞLIĞI =====
      doc.font("DejaVuBold").fontSize(14).text("Sipariş Kalemleri", margin, doc.y, {
        width: usableWidth,
      });
      doc.moveDown(0.6);

      // ===== KOLONLAR =====
      const gap = 12;
      const wMiktar = 70;
      const wBirim = 140;
      const wTutar = 90;

      const fixed = wMiktar + wBirim + wTutar + gap * 3;
      const wUrun = Math.max(220, usableWidth - fixed);

      const col = {
        urunX: margin,
        urunW: wUrun,

        miktarX: margin + wUrun + gap,
        miktarW: wMiktar,

        birimX: margin + wUrun + gap + wMiktar + gap,
        birimW: wBirim,

        tutarX: margin + usableWidth - wTutar,
        tutarW: wTutar,
      };

      const drawTableHeader = () => {
        doc.font("DejaVuBold").fontSize(11);
        const y0 = doc.y;
        doc.text("Ürün", col.urunX, y0, { width: col.urunW });
        doc.text("Miktar", col.miktarX, y0, { width: col.miktarW });
        doc.text("Birim", col.birimX, y0, { width: col.birimW });
        doc.text("Tutar", col.tutarX, y0, { width: col.tutarW, align: "right" });

        doc.moveDown(0.6);
        hline();
        doc.moveDown(0.4);
        doc.font("DejaVu").fontSize(11);
      };

      drawTableHeader();

      // ===== SATIRLAR =====
      doc.font("DejaVu").fontSize(11);

      let totalEur = 0;

      const list = Array.isArray(items) ? items : [];

      for (const it of list) {
        ensureSpace(70);

        const productName = safeText(it.product_name);
        const qtyNum = Number(it.quantity || 0);
        const unitLabel = safeText(it.unit_label).toLowerCase();

        const unitPriceTxt = `${money(it.unit_price_eur)} / ${unitLabel}`;
        const lineTotal = Number(it.line_total_eur || 0);

        totalEur += lineTotal;

        const y = doc.y;

        const hU = doc.heightOfString(productName, { width: col.urunW });
        const hB = doc.heightOfString(unitPriceTxt, { width: col.birimW });
        const rowH = Math.max(18, hU, hB);

        doc.text(productName, col.urunX, y, { width: col.urunW });
        doc.text(fmtQty(qtyNum), col.miktarX, y, { width: col.miktarW });
        doc.text(unitPriceTxt, col.birimX, y, { width: col.birimW });
        doc.text(money(lineTotal), col.tutarX, y, {
          width: col.tutarW,
          align: "right",
        });

        doc.y = y + rowH + 10;
      }

      hline();
      doc.moveDown(0.8);

      // ===== SAĞ ALTTA SADECE TOPLAM (ÇAKIŞMAYI BİTİRİR) =====
      ensureSpace(70);

      // Sağ alt blok: TOPLAM etiketi + değer, aralarında net boşluk
      const yTot = doc.y;

      const rightBlockW = col.birimW + 12 + col.tutarW; // toplam blok genişliği
      const rightBlockX = margin + usableWidth - rightBlockW;

      const wLabel = 110; // "TOPLAM:" için sabit alan (çakışmayı engeller)
      const wValue = col.tutarW;
      const xLabel = rightBlockX + (rightBlockW - (wLabel + 12 + wValue));
      const xValue = xLabel + wLabel + 12;

      doc.font("DejaVuBold").fontSize(12).text("TOPLAM:", xLabel, yTot, {
        width: wLabel,
        align: "right",
      });

      doc.font("DejaVuBold").fontSize(12).text(money(totalEur), xValue, yTot, {
        width: wValue,
        align: "right",
      });

      // ===== FOOTER (sayfanın en altına sabit, istersek kaldırırız) =====
      doc.font("DejaVu").fontSize(footerFontSize).text(
        footerText,
        margin,
        footerY(),
        { width: usableWidth, align: "left" }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { buildOrderPdf };
