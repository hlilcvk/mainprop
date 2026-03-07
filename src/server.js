import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import admin from "firebase-admin";

import pool from "./db.js";
import { initDatabase } from "./db-init.js";

import trackRoute from "./routes/track.js";
import requestCodeRoute from "./routes/request-code.js";
import verifyCodeRoute from "./routes/verify-code.js";
import statsRoute from "./routes/stats.js";
import adminRoute from "./routes/admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

/* ---------- Middleware ---------- */
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ---------- Security Headers ---------- */
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

/* ---------- API Routes ---------- */
app.use("/api", trackRoute);
app.use("/api", requestCodeRoute);
app.use("/api", verifyCodeRoute);
app.use("/api", statsRoute);
app.use("/api", adminRoute);

// Legacy Netlify paths
app.use("/.netlify/functions", trackRoute);
app.use("/.netlify/functions", requestCodeRoute);
app.use("/.netlify/functions", verifyCodeRoute);
app.use("/.netlify/functions", statsRoute);

/* ---------- Health Check ---------- */
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ---------- Static Files ---------- */
app.use(
  express.static(join(__dirname, "..", "public"), {
    maxAge: "1h",
    etag: true,
  })
);

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "..", "public", "index.html"));
});

/* ---------- Boot ---------- */
async function boot() {
  // 1. Init database schema
  try {
    await initDatabase();
  } catch (err) {
    console.error("[BOOT] DB init failed:", err.message);
    process.exit(1);
  }

  // 2. Init Firebase from DB settings
  try {
    const fbResult = await pool.query("SELECT value FROM system_settings WHERE key = 'firebase_config'");
    if (fbResult.rows.length > 0) {
      const cfg = fbResult.rows[0].value;
      if (cfg && cfg.projectId && cfg.clientEmail && cfg.privateKey) {
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: cfg.projectId,
              clientEmail: cfg.clientEmail,
              privateKey: cfg.privateKey.replace(/\\n/g, "\n"),
            }),
          });
          console.log("[BOOT] Firebase Admin initialized from DB.");
        }
      }
    }
  } catch {
    console.log("[BOOT] No Firebase config in DB, checking ENV...");
  }

  // 3. Fallback to ENV
  if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
        }),
      });
      console.log("[BOOT] Firebase Admin initialized from ENV.");
    } catch (err) {
      console.log("[BOOT] Firebase ENV init failed:", err.message);
    }
  }

  // 4. Start server
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[BOOT] PROPTREX v5 running on port ${PORT}`);
  });
}

boot();
