import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

export async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const mechanism = authHeader.split(" ")[0];
  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing authorization token" });
  }

  // Secret bypass (setup key)
  if (mechanism === "Secret") {
    const expected = process.env.ADMIN_SECRET;
    if (expected && token === expected) {
      req.adminEmail = "Setup Key Admin";
      return next();
    }
    return res.status(403).json({ ok: false, error: "Invalid Setup Key" });
  }

  // Firebase token
  if (!admin.apps.length) {
    return res.status(503).json({ ok: false, error: "Firebase Admin not initialized. Save Firebase config and restart." });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    const email = String(decoded.email || "").toLowerCase();
    const allowed = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (!email || !allowed.includes(email)) {
      return res.status(403).json({ ok: false, error: "Not an authorized admin" });
    }

    req.adminEmail = email;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}
