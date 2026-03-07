import { Router } from "express";
import pool from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const pv24Res = await pool.query(`SELECT COUNT(*) as cnt FROM pageviews WHERE ts >= $1`, [since24]);
    const pv24 = parseInt(pv24Res.rows[0].cnt, 10);

    const uv24Res = await pool.query(`SELECT COUNT(DISTINCT ip_hash) as cnt FROM pageviews WHERE ts >= $1`, [since24]);
    const uv24 = parseInt(uv24Res.rows[0].cnt, 10);

    const wlRes = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'verified') as verified FROM waitlist`);
    const signups_total = parseInt(wlRes.rows[0].total, 10);
    const verified_total = parseInt(wlRes.rows[0].verified, 10);

    const pvDailyRes = await pool.query(
      `SELECT date_trunc('day', ts AT TIME ZONE 'UTC')::date as day, COUNT(*) as pageviews, COUNT(DISTINCT ip_hash) as uniques
       FROM pageviews WHERE ts >= $1 GROUP BY day ORDER BY day`,
      [since7]
    );

    const wlDailyRes = await pool.query(
      `SELECT date_trunc('day', ts AT TIME ZONE 'UTC')::date as day, COUNT(*) FILTER (WHERE status = 'verified') as verified
       FROM waitlist WHERE ts >= $1 GROUP BY day ORDER BY day`,
      [since7]
    );

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

    return res.json({ ok: true, pv24, uv24, signups_total, verified_total, last7days });
  } catch (err) {
    console.error("[STATS]", err.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
