import nodemailer from "nodemailer";
import pool from "./db.js";

let cachedTransporter = null;
let cachedMailFrom = null;

export function resetTransporter() {
  cachedTransporter = null;
  cachedMailFrom = null;
}

async function getTransporter() {
  if (cachedTransporter) return { transporter: cachedTransporter, mailFrom: cachedMailFrom };

  let host = process.env.SMTP_HOST || "localhost";
  let port = parseInt(process.env.SMTP_PORT || "587", 10);
  let secure = process.env.SMTP_SECURE === "true";
  let user = process.env.SMTP_USER || "";
  let pass = process.env.SMTP_PASS || "";
  let tlsReject = process.env.SMTP_TLS_REJECT !== "false";
  let mailFrom = process.env.MAIL_FROM || "PROPTREX <noreply@proptrex.com>";

  try {
    const res = await pool.query("SELECT value FROM system_settings WHERE key = 'smtp_config'");
    if (res.rows.length > 0) {
      const db = res.rows[0].value;
      if (db && db.host) {
        host = db.host;
        port = parseInt(db.port || "587", 10);
        secure = !!db.secure;
        user = db.user || "";
        pass = db.pass || "";
        tlsReject = !!db.tlsReject;
      }
      if (db && db.mailFrom) mailFrom = db.mailFrom;
    }
  } catch (err) {
    console.error("[MAIL] DB config load failed:", err.message);
  }

  // Port 465 ise secure otomatik true yap
  if (port === 465) secure = true;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: tlsReject },
  });

  cachedMailFrom = mailFrom;
  return { transporter: cachedTransporter, mailFrom: cachedMailFrom };
}

export async function sendEmail(to, subject, html) {
  const { transporter: t, mailFrom } = await getTransporter();
  await t.sendMail({ from: mailFrom, to, subject, html });
}
