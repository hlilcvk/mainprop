import nodemailer from "nodemailer";
import pool from "./db.js";

let transporter = null;

export function resetTransporter() {
  transporter = null;
}

async function getTransporter() {
  if (transporter) return transporter;

  let host = process.env.SMTP_HOST || "localhost";
  let port = parseInt(process.env.SMTP_PORT || "587", 10);
  let secure = process.env.SMTP_SECURE === "true";
  let user = process.env.SMTP_USER || "";
  let pass = process.env.SMTP_PASS || "";
  let tlsReject = process.env.SMTP_TLS_REJECT !== "false";

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
    }
  } catch (err) {
    console.error("[MAIL] DB config load failed:", err.message);
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

export async function sendEmail(to, subject, html) {
  const from = process.env.MAIL_FROM || "PROPTREX <noreply@proptrex.com>";
  const t = await getTransporter();
  await t.sendMail({ from, to, subject, html });
}
