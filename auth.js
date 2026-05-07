const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

// ── Database setup ────────────────────────────────────────────────────────────
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "users.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
  );
`);

// ── Seed admin account ────────────────────────────────────────────────────────
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "amchargh@vivoaquatics.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "VivoAdmin2026!";

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL);
if (!existing) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  db.prepare(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)"
  ).run(ADMIN_EMAIL, "Adrian McHargh", hash, "admin");
  console.log(`Admin account seeded: ${ADMIN_EMAIL}`);
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "vivo-jwt-secret-change-in-production";
const JWT_EXPIRY = "8h";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.vivo_token || req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Session expired — please log in again" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    next();
  });
}

// ── User CRUD ─────────────────────────────────────────────────────────────────
function getAllUsers() {
  return db.prepare("SELECT id, email, name, role, created_at, created_by FROM users ORDER BY created_at DESC").all();
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function createUser({ email, name, password, role = "user", createdBy }) {
  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(email, name, hash, role, createdBy);
  return result.lastInsertRowid;
}

function updateUserPassword(id, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
}

function updateUserRole(id, role) {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

function deleteUser(id) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

function checkPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

module.exports = {
  requireAuth, requireAdmin,
  signToken, verifyToken,
  getAllUsers, getUserByEmail, createUser,
  updateUserPassword, updateUserRole, deleteUser, checkPassword,
};
