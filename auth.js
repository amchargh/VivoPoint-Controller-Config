require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");

// ── SQLite via sql.js (pure JS — no native compilation needed) ────────────────
const initSqlJs = require("sql.js");

const DB_DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "users.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
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
  saveDb();

  // Seed admin account
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "amchargh@vivoaquatics.com";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "VivoAdmin2026!";
  const existing = getOne("SELECT id FROM users WHERE email = ?", [ADMIN_EMAIL]);
  if (!existing) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    db.run(
      "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
      [ADMIN_EMAIL, "Adrian McHargh", hash, "admin"]
    );
    saveDb();
    console.log(`Admin account seeded: ${ADMIN_EMAIL}`);
  }
}

// ── Query helpers ─────────────────────────────────────────────────────────────
function getOne(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getAll(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params) {
  db.run(sql, params || []);
  saveDb();
}

// ── JWT ───────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "vivo-jwt-secret-change-in-production";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const t = req.cookies?.vivo_token || (req.headers.authorization || "").replace("Bearer ", "");
  if (!t) return res.status(401).json({ error: "Not authenticated" });
  const user = verifyToken(t);
  if (!user) return res.status(401).json({ error: "Session expired" });
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
  return getAll("SELECT id, email, name, role, created_at, created_by FROM users ORDER BY created_at DESC");
}

function getUserByEmail(email) {
  return getOne("SELECT * FROM users WHERE email = ?", [email]);
}

function createUser({ email, name, password, role = "user", createdBy }) {
  const hash = bcrypt.hashSync(password, 12);
  run("INSERT INTO users (email, name, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)",
    [email, name, hash, role, createdBy || null]);
  const created = getOne("SELECT id FROM users WHERE email = ?", [email]);
  return created ? created.id : null;
}

function updateUserPassword(id, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 12);
  run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id]);
}

function updateUserRole(id, role) {
  run("UPDATE users SET role = ? WHERE id = ?", [role, id]);
}

function deleteUser(id) {
  run("DELETE FROM users WHERE id = ?", [id]);
}

function checkPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

module.exports = {
  initDb,
  requireAuth, requireAdmin,
  signToken, verifyToken,
  getAllUsers, getUserByEmail, createUser,
  updateUserPassword, updateUserRole, deleteUser, checkPassword,
};
