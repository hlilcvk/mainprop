import { Router } from "express";
import admin from "firebase-admin";
import pool from "../db.js";

const router = Router();

function ensureFirebase() {
  if (admin.apps.length) return;

  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || "";

  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin not configured");
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

router.get("/stats", async (req, res) => {
  try {
    ensureFirebase();
  } catch {
    return res.status(503).json({ ok: false, error: "Admin auth not configured" });
  }

  const authz = req.headers["authorization"] || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }

  const email = String(decoded.email || "").toLowerCase();
  const allow = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!email || !allow.includes(email)) {
    return res.status(403).json({ ok: false, error: "Not allowed" });
  }

  try {
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 24h pageviews
    const pv24Res = await pool.query(
      `SELECT COUNT(*) as cnt FROM pageviews WHERE ts >= $1`,
      [since24]
    );
    const pv24 = parseInt(pv24Res.rows[0].cnt, 10);

    // 24h unique visitors
    const uv24Res = await pool.query(
      `SELECT COUNT(DISTINCT ip_hash) as cnt FROM pageviews WHERE ts >= $1`,
      [since24]
    );
    const uv24 = parseInt(uv24Res.rows[0].cnt, 10);

    // Total signups & verified
    const wlRes = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'verified') as verified FROM waitlist`
    );
    const signups_total = parseInt(wlRes.rows[0].total, 10);
    const verified_total = parseInt(wlRes.rows[0].verified, 10);

    // Son 7 gün daily breakdown
    const pvDailyRes = await pool.query(
      `SELECT
         date_trunc('day', ts AT TIME ZONE 'UTC')::date as day,
         COUNT(*) as pageviews,
         COUNT(DISTINCT ip_hash) as uniques
       FROM pageviews
       WHERE ts >= $1
       GROUP BY day
       ORDER BY day`,
      [since7]
    );

    const wlDailyRes = await pool.query(
      `SELECT
         date_trunc('day', ts AT TIME ZONE 'UTC')::date as day,
         COUNT(*) FILTER (WHERE status = 'verified') as verified
       FROM waitlist
       WHERE ts >= $1
       GROUP BY day
       ORDER BY day`,
      [since7]
    );

    // Son 7 günü doldur
    const pvMap = new Map(pvDailyRes.rows.map((r) => [r.day.toISOString().slice(0, 10), r]));
    const wlMap = new Map(wlDailyRes.rows.map((r) => [r.day.toISOString().slice(0, 10), r]));

    const last7days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const pv = pvMap.get(key);
      const wl = wlMap.get(key);
      last7days.push({
        day: key,
        pageviews: pv ? parseInt(pv.pageviews, 10) : 0,
        uniques: pv ? parseInt(pv.uniques, 10) : 0,
        verified: wl ? parseInt(wl.verified, 10) : 0,
      });
    }

    return res.json({
      ok: true,
      pv24,
      uv24,
      signups_total,
      verified_total,
      last7days,
    });
  } catch (err) {
    console.error("stats error:", err.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
