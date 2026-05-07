require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const RMS_BASE = "https://rms.teltonika-networks.com/api";

// Read token at request time so Railway env var updates take effect without restart
function token() {
  return process.env.RMS_API_TOKEN || "";
}

function rmsHeaders() {
  return {
    Authorization: `Bearer ${token()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Generic RMS GET helper — returns parsed JSON or throws with status + body
async function rmsGet(path) {
  const res = await fetch(`${RMS_BASE}${path}`, { headers: rmsHeaders() });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`RMS ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return json;
}

async function rmsPost(path, body) {
  const res = await fetch(`${RMS_BASE}${path}`, {
    method: "POST",
    headers: rmsHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`RMS ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return json;
}

// ── Health — instant, no RMS call ────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, token_set: !!token() });
});

// ── Ping — actually tests RMS connectivity ────────────────────────────────────
app.get("/api/ping", async (req, res) => {
  if (!token()) return res.json({ ok: false, error: "RMS_API_TOKEN not set" });
  try {
    await rmsGet("/devices?limit=1");
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Devices ───────────────────────────────────────────────────────────────────
app.get("/api/devices", async (req, res) => {
  try {
    const all = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const data = await rmsGet(`/devices?offset=${offset}&limit=100`);
      const devices = data.data || [];
      const existing = new Set(all.map((d) => d.id));
      all.push(...devices.filter((d) => !existing.has(d.id)));
      if (devices.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) {
    console.error("GET /api/devices:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/devices/:id", async (req, res) => {
  try {
    const data = await rmsGet(`/devices/${req.params.id}`);
    res.json(data);
  } catch (e) {
    console.error(`GET /api/devices/${req.params.id}:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Task Groups ───────────────────────────────────────────────────────────────
app.get("/api/task-groups", async (req, res) => {
  try {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const data = await rmsGet(`/devices/tasks/groups?page=${page}&limit=100`);
      const groups = data.data || [];
      all.push(...groups);
      if (groups.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) {
    console.error("GET /api/task-groups:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Get first task ID inside a group ─────────────────────────────────────────
// Mirrors Python get_first_task_id():
//   GET /devices/tasks (global list, paginated) → filter by group_id → lowest id
app.get("/api/task-groups/:groupId/first-task", async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  try {
    const groupTasks = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const data = await rmsGet(`/devices/tasks?offset=${offset}&limit=200`);
      const tasks = data.data || [];
      groupTasks.push(...tasks.filter((t) => t.group_id === groupId));
      if (tasks.length < 200) break;
    }
    if (!groupTasks.length) {
      return res.status(404).json({ error: `No tasks found in group ${groupId}` });
    }
    const seen = new Set();
    const unique = groupTasks
      .filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
      .sort((a, b) => a.id - b.id);
    const first = unique[0];
    res.json({ task_id: first.id, task_name: first.name, group_id: groupId });
  } catch (e) {
    console.error(`GET /api/task-groups/${groupId}/first-task:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Execute task group on a device ───────────────────────────────────────────
// Mirrors Python execute_first_task():
//   POST /devices/tasks/groups/{group_id}
//   Body: { device_id: [rms_device_id], tasks: [{ task_id, variables: [] }] }
app.post("/api/devices/:deviceId/execute-task", async (req, res) => {
  const { task_group_id, task_id } = req.body;
  const device_id = req.params.deviceId;
  if (!task_group_id || !task_id) {
    return res.status(400).json({ error: "task_group_id and task_id required" });
  }
  try {
    const data = await rmsPost(`/devices/tasks/groups/${task_group_id}`, {
      device_id: [device_id],
      tasks: [{ task_id: task_id, variables: [] }],
    });
    res.json(data);
  } catch (e) {
    console.error(`POST /api/devices/${device_id}/execute-task:`, e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Tags ──────────────────────────────────────────────────────────────────────
app.get("/api/tags", async (req, res) => {
  try {
    res.json(await rmsGet("/tags"));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/tags", async (req, res) => {
  try {
    res.json(await rmsPost("/tags", req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post("/api/devices/:id/tags", async (req, res) => {
  try {
    res.json(await rmsPost(`/devices/${req.params.id}/tags`, req.body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Files (UUID Downloader) ───────────────────────────────────────────────────
app.get("/api/files", async (req, res) => {
  try {
    res.json(await rmsGet("/files"));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/files/:id/download", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/files/${req.params.id}/download`, {
      headers: rmsHeaders(),
    });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ── Catch-all → SPA ───────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VivoPoint Config Tool running on port ${PORT}`);
  console.log(`RMS_API_TOKEN: ${token() ? "SET (" + token().slice(0, 12) + "...)" : "NOT SET"}`);
  console.log(`Node version: ${process.version}`);
});
