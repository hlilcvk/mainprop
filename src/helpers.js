import crypto from "crypto";

export function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export function rand6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function isEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

export function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "0.0.0.0"
  );
}
