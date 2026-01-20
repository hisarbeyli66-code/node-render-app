const nodemailer = require("nodemailer");

function createTransport() {
  return nodemailer.createTransport({
    host: "ha01s027.org-dns.com",
    port: 587,
    secure: false, // STARTTLS
    requireTLS: true,
    auth: {
      user: "siparis@igmg-lauffen.de",
      pass: "10KgKiyma!"
    },
    tls: {
      rejectUnauthorized: true
    }
  });
}

async function sendOrderEmails({ adminTo, customerTo, subject, text, pdfBuffer, pdfFilename }) {
  const transporter = createTransport();

  const common = {
    from: `"Aytaç - Helal Et Siparişi" <siparis@igmg-lauffen.de>`,
    subject,
    text,
    attachments: [
      {
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  };

  await transporter.sendMail({ ...common, to: adminTo });

  if (customerTo) {
    await transporter.sendMail({ ...common, to: customerTo });
  }
}

module.exports = { sendOrderEmails };
