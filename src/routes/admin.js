import { Router } from "express";
import pool from "../db.js";
import admin from "firebase-admin";
import { requireAdmin } from "../middleware/auth.js";
import { sendEmail, resetTransporter } from "../mail.js";

const router = Router();

/* ---- Users API ---- */

router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, ts, email, first_name, last_name, city, profile, note, source, status, extra_fields, verified_at
      FROM waitlist ORDER BY id DESC
    `);
    return res.json({ ok: true, users: result.rows });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

router.put("/admin/users/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, city, profile, note, extra_fields } = req.body;

  try {
    await pool.query(
      `UPDATE waitlist SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        city = COALESCE($3, city),
        profile = COALESCE($4, profile),
        note = COALESCE($5, note),
        extra_fields = COALESCE($6, extra_fields)
       WHERE id = $7`,
      [first_name, last_name, city, profile, note, extra_fields, id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM waitlist WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

router.post("/admin/users/:id/request-info", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { additionalMessage } = req.body;

  try {
    const result = await pool.query("SELECT email, first_name FROM waitlist WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

    const user = result.rows[0];
    const name = user.first_name || "there";

    const subject = "PROPTREX - Additional Information Required";
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0B1220">
        <h2 style="margin:0 0 10px">PROPTREX Early Access</h2>
        <p style="margin:0 0 14px;color:#58647A">
          Hi ${name},<br/><br/>
          We have received your early access request. To properly evaluate your profile, we need a bit more information.
        </p>
        <div style="padding:14px;border:1px solid rgba(10,20,35,.12);border-radius:14px;background:#F7F9FF;margin-bottom:14px;">
          ${additionalMessage || "Please reply to this email with details regarding your primary trading focus, strategies, and average monthly volume."}
        </div>
        <p style="margin:14px 0 0;color:#58647A;font-size:12px">
          Simply reply to this email to provide the requested information.
        </p>
      </div>
    `;

    await sendEmail(user.email, subject, html);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Mail or database error" });
  }
});

/* ---- Settings API ---- */

router.get("/admin/settings", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT key, value FROM system_settings");
    const settings = {};
    result.rows.forEach((r) => (settings[r.key] = r.value));
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

// Public settings (no auth)
router.get("/settings/public", async (req, res) => {
  try {
    const result = await pool.query("SELECT key, value FROM system_settings WHERE key IN ($1, $2)", [
      "dynamic_form_fields",
      "firebase_config",
    ]);
    const settings = {};
    result.rows.forEach((r) => {
      if (r.key === "firebase_config") {
        settings[r.key] = {
          apiKey: r.value.apiKey,
          authDomain: r.value.authDomain,
          projectId: r.value.projectId,
          appId: r.value.appId,
        };
      } else {
        settings[r.key] = r.value;
      }
    });
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

router.put("/admin/settings/:key", requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );

    // Re-init Firebase if config changed
    if (key === "firebase_config" && value && value.projectId && value.clientEmail && value.privateKey) {
      try {
        if (admin.apps.length) await admin.app().delete();
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: value.projectId,
            clientEmail: value.clientEmail,
            privateKey: value.privateKey.replace(/\\n/g, "\n"),
          }),
        });
        console.log("[ADMIN] Firebase Admin re-initialized.");
      } catch (fbErr) {
        console.error("[ADMIN] Firebase re-init failed:", fbErr.message);
      }
    }

    // Reset SMTP transporter cache if smtp config changed
    if (key === "smtp_config") {
      resetTransporter();
      console.log("[ADMIN] SMTP transporter cache cleared.");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN]", err.message);
    return res.status(500).json({ ok: false, error: "Database error" });
  }
});

export default router;
