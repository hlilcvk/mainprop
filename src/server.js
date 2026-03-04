import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import trackRoute from "./routes/track.js";
import requestCodeRoute from "./routes/request-code.js";
import verifyCodeRoute from "./routes/verify-code.js";
import statsRoute from "./routes/stats.js";
import adminRoute from "./routes/admin.js";

import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

/* ---------- Middleware ---------- */
app.set("trust proxy", true);

app.use(
  helmet({
    contentSecurityPolicy: false, // HTML dosyaları harici script yüklüyor
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Genel rate limit
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
// Netlify functions path'lerini de destekle (uyumluluk)
app.use("/api", trackRoute);
app.use("/api", requestCodeRoute);
app.use("/api", verifyCodeRoute);
app.use("/api", statsRoute);
app.use("/api", adminRoute);

// Eski Netlify path'leri -> yeni API'ye yönlendir (geriye uyumluluk)
app.use("/.netlify/functions", trackRoute);
app.use("/.netlify/functions", requestCodeRoute);
app.use("/.netlify/functions", verifyCodeRoute);
app.use("/.netlify/functions", statsRoute);

/* ---------- Health Check ---------- */
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ---------- Statik Dosyalar ---------- */
app.use(express.static(join(__dirname, "..", "public"), {
  maxAge: "1h",
  etag: true,
}));

// SPA fallback - tüm bilinmeyen path'leri index.html'e yönlendir
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "..", "public", "index.html"));
});

/* ---------- Başlat ---------- */
import pool from "./db.js";

async function bootServer() {
  try {
    // Try to load firebase credentials from DB settings to init admin early if available
    const fbCfgResult = await pool.query("SELECT value FROM system_settings WHERE key = 'firebase_config'");
    if (fbCfgResult.rows.length > 0) {
      const fbConfig = fbCfgResult.rows[0].value;
      if (fbConfig && fbConfig.projectId && fbConfig.clientEmail && fbConfig.privateKey) {
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId: fbConfig.projectId,
              clientEmail: fbConfig.clientEmail,
              // Handle escaped newlines properly
              privateKey: fbConfig.privateKey.replace(/\\n/g, '\n')
            })
          });
          console.log("Firebase Admin initialized from Database settings.");
        }
      }
    }
  } catch (err) {
    console.log("Could not init Firebase Admin from DB early, continuing boot...");
  }

  // Also fallback to ENV initialization
  if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n')
        })
      });
      console.log("Firebase Admin initialized from ENV variables.");
    } catch (err) {
      console.log("Failed to init Firebase from ENV", err.message);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PROPTREX server running on port ${PORT}`);
  });
}

bootServer();
