import nodemailer from "nodemailer";

import pool from "./db.js";

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  let host = process.env.SMTP_HOST || "localhost";
  let port = parseInt(process.env.SMTP_PORT || "587", 10);
  let secure = process.env.SMTP_SECURE === "true";
  let user = process.env.SMTP_USER || "";
  let pass = process.env.SMTP_PASS || "";
  let tlsReject = process.env.SMTP_TLS_REJECT !== "false";

  // Try to override from DB settings
  try {
    const res = await pool.query("SELECT value FROM system_settings WHERE key = 'smtp_config'");
    if (res.rows.length > 0) {
      const dbSmtp = res.rows[0].value;
      if (dbSmtp && dbSmtp.host) {
        host = dbSmtp.host;
        port = parseInt(dbSmtp.port || "587", 10);
        secure = !!dbSmtp.secure;
        user = dbSmtp.user || "";
        pass = dbSmtp.pass || "";
        tlsReject = !!dbSmtp.tlsReject;
      }
    }
  } catch (err) {
    console.error("Failed to load SMTP config from DB:", err.message);
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: tlsReject },
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
  const t = await getTransporter();
  await t.sendMail({ from, to, subject, html });
}
