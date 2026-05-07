require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const auth = require("./auth");

const app = express();
app.use(express.json());
app.use(cookieParser());

const RMS_BASE = "https://rms.teltonika-networks.com/api";

function token() { return process.env.RMS_API_TOKEN || ""; }
function rmsHeaders() {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function rmsGet(p) {
  const r = await fetch(`${RMS_BASE}${p}`, { headers: rmsHeaders() });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error(`RMS ${r.status}: ${text.slice(0,200)}`), { status: r.status });
  return json;
}

async function rmsPost(p, body) {
  const r = await fetch(`${RMS_BASE}${p}`, { method: "POST", headers: rmsHeaders(), body: JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error(`RMS ${r.status}: ${text.slice(0,200)}`), { status: r.status });
  return json;
}

// ── Auth routes (public) ──────────────────────────────────────────────────────

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = auth.getUserByEmail(email.toLowerCase().trim());
  if (!user || !auth.checkPassword(user, password)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = auth.signToken(user);
  res.cookie("vivo_token", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vivo_token");
  res.json({ ok: true });
});

app.get("/api/auth/me", auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── Admin: user management ────────────────────────────────────────────────────

app.get("/api/admin/users", auth.requireAdmin, (req, res) => {
  res.json({ users: auth.getAllUsers() });
});

app.post("/api/admin/users", auth.requireAdmin, (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: "email, name, and password required" });
  if (auth.getUserByEmail(email.toLowerCase().trim())) return res.status(409).json({ error: "User with this email already exists" });
  try {
    const id = auth.createUser({ email: email.toLowerCase().trim(), name, password, role: role || "user", createdBy: req.user.email });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/users/:id/password", auth.requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  auth.updateUserPassword(parseInt(req.params.id), password);
  res.json({ ok: true });
});

app.patch("/api/admin/users/:id/role", auth.requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!["admin","user"].includes(role)) return res.status(400).json({ error: "Role must be admin or user" });
  auth.updateUserRole(parseInt(req.params.id), role);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", auth.requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
  auth.deleteUser(parseInt(req.params.id));
  res.json({ ok: true });
});

// ── Health (public) ───────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, token_set: !!token() });
});

// ── All RMS routes require auth ───────────────────────────────────────────────

app.get("/api/devices", auth.requireAuth, async (req, res) => {
  try {
    const all = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const data = await rmsGet(`/devices?offset=${offset}&limit=100`);
      const devices = data.data || [];
      const existing = new Set(all.map(d => d.id));
      all.push(...devices.filter(d => !existing.has(d.id)));
      if (devices.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/devices/:id", auth.requireAuth, async (req, res) => {
  try { res.json(await rmsGet(`/devices/${req.params.id}`)); }
  catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/task-groups", auth.requireAuth, async (req, res) => {
  try {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const data = await rmsGet(`/devices/tasks/groups?page=${page}&limit=100`);
      const groups = data.data || [];
      all.push(...groups);
      if (groups.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/task-groups/:groupId/first-task", auth.requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  try {
    const groupTasks = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const data = await rmsGet(`/devices/tasks?offset=${offset}&limit=200`);
      const tasks = data.data || [];
      groupTasks.push(...tasks.filter(t => t.group_id === groupId));
      if (tasks.length < 200) break;
    }
    if (!groupTasks.length) return res.status(404).json({ error: `No tasks found in group ${groupId}` });
    const seen = new Set();
    const unique = groupTasks.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; }).sort((a,b) => a.id - b.id);
    const first = unique[0];
    res.json({ task_id: first.id, task_name: first.name, group_id: groupId });
  } catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.post("/api/devices/:deviceId/execute-task", auth.requireAuth, async (req, res) => {
  const { task_group_id, task_id } = req.body;
  const device_id = req.params.deviceId;
  if (!task_group_id || !task_id) return res.status(400).json({ error: "task_group_id and task_id required" });
  try {
    const data = await rmsPost(`/devices/tasks/groups/${task_group_id}`, {
      device_id: [device_id], tasks: [{ task_id, variables: [] }],
    });
    res.json(data);
  } catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/tags", auth.requireAuth, async (req, res) => {
  try { res.json(await rmsGet("/tags")); }
  catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.post("/api/tags", auth.requireAuth, async (req, res) => {
  try { res.json(await rmsPost("/tags", req.body)); }
  catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.post("/api/devices/:id/tags", auth.requireAuth, async (req, res) => {
  try { res.json(await rmsPost(`/devices/${req.params.id}/tags`, req.body)); }
  catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/files", auth.requireAuth, async (req, res) => {
  try { res.json(await rmsGet("/files")); }
  catch (e) { res.status(e.status||500).json({ error: e.message }); }
});

app.get("/api/files/:id/download", auth.requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/files/${req.params.id}/download`, { headers: rmsHeaders() });
    res.status(r.status).send(await r.text());
  } catch (e) { res.status(500).send(e.message); }
});

// ── Static + SPA ──────────────────────────────────────────────────────────────
// Login page is always public
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// Everything else: serve static files, but protect the app
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
auth.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`VivoPoint Config Tool running on port ${PORT}`);
    console.log(`RMS_API_TOKEN: ${token() ? "SET (" + token().slice(0,12) + "...)" : "NOT SET"}`);
    console.log(`Node: ${process.version}`);
  });
}).catch(e => {
  console.error("Failed to init database:", e);
  process.exit(1);
});
