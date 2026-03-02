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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PROPTREX server running on port ${PORT}`);
});
