import { Router } from "express";
import pool from "../db.js";
import { getAuth } from "firebase-admin/auth";
import admin from "firebase-admin";

const router = Router();

// Middleware to check Admin privileges using Firebase token
// Expects header: "Authorization: Bearer <ID_TOKEN>" or "Authorization: Secret <ADMIN_SECRET>"
async function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const mechanism = authHeader.split(" ")[0]; // Bearer or Secret
    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ ok: false, error: "Missing authorization token" });
    }

    // 1. Check Secret Bypas (for initial setup)
    if (mechanism === "Secret") {
        const expectedSecret = process.env.ADMIN_SECRET;
        if (expectedSecret && token === expectedSecret) {
            req.adminEmail = "Setup Key Admin";
            return next();
        }
        return res.status(403).json({ ok: false, error: "Invalid Setup Key" });
    }

    // 2. Check Standard Firebase Token
    // Check if firebase admin is initialized first
    if (!admin.apps.length) {
        return res.status(503).json({ ok: false, error: "Firebase Admin not initialized on server" });
    }

    try {
        const decodedToken = await getAuth().verifyIdToken(token);
        const email = decodedToken.email;

        // Check if email is in ADMIN_EMAILS env variable
        const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
        if (!adminEmails.includes(email.toLowerCase())) {
            return res.status(403).json({ ok: false, error: "Not an authorized admin" });
        }

        req.adminEmail = email;
        next();
    } catch (error) {
        console.error("Admin Auth Error:", error.message);
        return res.status(401).json({ ok: false, error: "Invalid token" });
    }
}

/* ---------- Users API ---------- */

// Get all verified users 
router.get("/admin/users", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT id, ts, email, first_name, last_name, city, profile, note, source, status, extra_fields, verified_at 
      FROM waitlist 
      ORDER BY id DESC
    `);
        return res.json({ ok: true, users: result.rows });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

// Update a user (e.g. approve, edit name, city, extra fields)
router.put("/admin/users/:id", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, city, profile, note, extra_fields } = req.body;

    try {
        await pool.query(
            `UPDATE waitlist 
       SET 
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
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

// Send auto email requesting more info
import { sendEmail } from "../mail.js";

router.post("/admin/users/:id/request-info", requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { additionalMessage } = req.body;

    try {
        const result = await pool.query('SELECT email, first_name FROM waitlist WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ ok: false, error: "User not found" });

        const user = result.rows[0];
        const name = user.first_name || "there";

        const subject = "PROPTREX - Additional Information Required";
        const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0B1220">
        <h2 style="margin:0 0 10px">PROPTREX Early Access</h2>
        <p style="margin:0 0 14px;color:#58647A">
          Hi ${name},<br/><br/>
          We have received your early access request. To properly evaluate your profile for the first access list, we need a bit more information.
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
        console.error("request-info error:", err.message);
        return res.status(500).json({ ok: false, error: "Database or Mail error" });
    }
});

/* ---------- Settings API ---------- */

// Get all system settings
router.get("/admin/settings", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM system_settings');
        const settings = {};
        result.rows.forEach(r => settings[r.key] = r.value);
        return res.json({ ok: true, settings });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

// Get PUBLIC settings (No Auth Required) - Used for dynamic forms on index.html
router.get("/settings/public", async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM system_settings WHERE key IN ($1, $2)', ['dynamic_form_fields', 'firebase_config']);
        const settings = {};
        result.rows.forEach(r => {
            if (r.key === 'firebase_config') {
                // Send only safe public keys
                const safeConfig = {
                    apiKey: r.value.apiKey,
                    authDomain: r.value.authDomain,
                    projectId: r.value.projectId,
                    appId: r.value.appId
                };
                settings[r.key] = safeConfig;
            } else {
                settings[r.key] = r.value;
            }
        });
        return res.json({ ok: true, settings });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

// Update a setting
router.put("/admin/settings/:key", requireAdmin, async (req, res) => {
    const { key } = req.params;
    const { value } = req.body; // value must be valid JSON

    try {
        await pool.query(
            `INSERT INTO system_settings (key, value, updated_at) 
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [key, value]
        );

        // If firebase config changed, we might need to re-init (but restarting server is cleaner)
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, error: "Database error" });
    }
});

export default router;
