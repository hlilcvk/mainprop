import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    // Coolify'da kendi SMTP (ör. mailserver) kullanıyorsanız
    // TLS doğrulamasını kapatabilirsiniz:
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT !== "false",
    },
  });

  return transporter;
}

/**
 * E-posta gönder
 * @param {string} to - Alıcı
 * @param {string} subject - Konu
 * @param {string} html - HTML içerik
 */
export async function sendEmail(to, subject, html) {
  const from = process.env.MAIL_FROM || "PROPTREX <noreply@proptrex.com>";
  const t = getTransporter();
  await t.sendMail({ from, to, subject, html });
}
