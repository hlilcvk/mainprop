import { Router } from "express";
import pool from "../db.js";
import { sha256, getClientIp } from "../helpers.js";

const router = Router();

router.post("/track", async (req, res) => {
  try {
    const path = String(req.body.path || "/").slice(0, 160);
    const ref = String(req.body.ref || "").slice(0, 400);
    const ip = getClientIp(req);
    const ua = req.headers["user-agent"] || "";

    const ip_hash = sha256(ip + "|pv");
    const ua_hash = sha256(ua + "|pv");

    await pool.query(
      `INSERT INTO pageviews (ip_hash, ua_hash, path, ref, event) VALUES ($1, $2, $3, $4, 'pageview')`,
      [ip_hash, ua_hash, path, ref]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("track error:", err.message);
    // Sessizce başarılı dön, analytics kaybı kritik değil
    res.json({ ok: true });
  }
});

export default router;
