require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());

// Connexion à la base de données Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Création des tables au démarrage
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY, whitelist INTEGER DEFAULT 0, blacklist INTEGER DEFAULT 0, key_id INTEGER, hwid TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keys (
      id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, redeemed_by TEXT, redeemed_at BIGINT, status TEXT DEFAULT 'unused'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY, key TEXT NOT NULL, session_id TEXT NOT NULL, expires_at BIGINT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cracks (
      id SERIAL PRIMARY KEY, key TEXT, discord_id TEXT, hwid TEXT, detected_at BIGINT, source TEXT
    )
  `);
  console.log("Database connected & Tables ready.");
}
initDB().catch(err => console.error("DB init error:", err));

// Route de base pour vérifier que l'API est en ligne
app.get("/", (req, res) => {
  res.send("Nethers API is running ✅");
});

// Route qui sert le loader
app.get("/static_loader", (req, res) => {
  res.sendFile(path.join(__dirname, "static_loader.lua"), (err) => {
    if (err) res.status(404).send("-- Loader not found");
  });
});

// Route qui valide la clé et donne un token
app.post("/api/load", async (req, res) => {
  const { key, hwid, session_id } = req.body;
  if (!key || !session_id) return res.status(400).json({ error: "Missing key or session." });

  const keyRes = await pool.query("SELECT * FROM keys WHERE key = $1", [key]);
  const keyData = keyRes.rows[0];

  if (!keyData || keyData.status !== "redeemed") return res.status(403).json({ error: "Invalid key." });

  const userRes = await pool.query("SELECT * FROM users WHERE key_id = $1", [keyData.id]);
  const userData = userRes.rows[0];

  if (!userData) return res.status(403).json({ error: "User not found." });
  if (userData.blacklist === 1) return res.status(403).json({ error: "You are banned." });

  if (!userData.hwid) {
    await pool.query("UPDATE users SET hwid = $1 WHERE discord_id = $2", [hwid, userData.discord_id]);
  } else if (userData.hwid !== hwid) {
    return res.status(403).json({ error: "Invalid HWID." });
  }

  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 60000;
  await pool.query("INSERT INTO tokens (token, key, session_id, expires_at) VALUES ($1, $2, $3, $4)", [token, key, session_id, expiresAt]);

  return res.json({ valid: true, token: token });
});

// Route qui sert le script final (nécessite un token valide)
app.get("/script", async (req, res) => {
  const { token, session_id } = req.query;
  if (!token || !session_id) return res.status(403).send("-- Missing token or session");

  const tokenRes = await pool.query("SELECT * FROM tokens WHERE token = $1 AND session_id = $2", [token, session_id]);
  const tokenData = tokenRes.rows[0];

  if (!tokenData || Date.now() > tokenData.expires_at) return res.status(403).send("-- Invalid or expired token");

  await pool.query("DELETE FROM tokens WHERE token = $1", [token]);
  
  // Remplace cette URL par le lien RAW de ton fichier script.lua sur GitHub
  const SCRIPT_URL = process.env.SCRIPT_URL || "https://raw.githubusercontent.com/TON-USER/TON-REPO/main/script.lua";
  
  try {
    const response = await fetch(SCRIPT_URL);
    const script = await response.text();
    res.type("text/plain").send(script);
  } catch (err) {
    res.status(500).send("-- Failed to load script");
  }
});

// Route pour le honeypot anti-crack
app.post("/api/leak-detected", async (req, res) => {
  const { hwid, userId } = req.body;
  await pool.query("INSERT INTO cracks (key, discord_id, hwid, detected_at, source) VALUES ($1, $2, $3, $4, $5)", ["NO_KEY", userId || "unknown", hwid || "unknown", Date.now(), "honeypot"]);
  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
