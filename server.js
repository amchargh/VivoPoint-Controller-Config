require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const RMS_BASE = "https://rms.teltonika-networks.com/api";
const RMS_TOKEN = process.env.RMS_API_TOKEN;

function rmsHeaders() {
  return {
    Authorization: `Bearer ${RMS_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, token_set: !!RMS_TOKEN });
});

// ── Devices ───────────────────────────────────────────────────────────────────
app.get("/api/devices", async (req, res) => {
  try {
    const all = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const r = await fetch(`${RMS_BASE}/devices?offset=${offset}&limit=100`, {
        headers: rmsHeaders(),
      });
      if (!r.ok) break;
      const data = await r.json();
      const devices = data.data || [];
      const newIds = new Set(all.map((d) => d.id));
      all.push(...devices.filter((d) => !newIds.has(d.id)));
      if (devices.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/devices/:id", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/devices/${req.params.id}`, {
      headers: rmsHeaders(),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/devices/:id/tasks/history", async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const r = await fetch(
      `${RMS_BASE}/devices/${req.params.id}/tasks/history?limit=${limit}`,
      { headers: rmsHeaders() }
    );
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Task Groups ───────────────────────────────────────────────────────────────
// Paginate all pages so no group is missed
app.get("/api/task-groups", async (req, res) => {
  try {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(
        `${RMS_BASE}/devices/tasks/groups?page=${page}&limit=100`,
        { headers: rmsHeaders() }
      );
      if (!r.ok) break;
      const data = await r.json();
      const groups = data.data || [];
      all.push(...groups);
      if (groups.length < 100) break;
    }
    res.json({ data: all });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get first task ID inside a group ─────────────────────────────────────────
// Mirrors Python get_first_task_id():
//   GET /devices/tasks?offset=X&limit=200  (global tasks list)
//   Filter by group_id == task_group_id
//   Return lowest task id
app.get("/api/task-groups/:groupId/first-task", async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  try {
    const groupTasks = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = await fetch(
        `${RMS_BASE}/devices/tasks?offset=${offset}&limit=200`,
        { headers: rmsHeaders() }
      );
      if (!r.ok) {
        console.error(`GET /devices/tasks offset=${offset} → ${r.status}`);
        break;
      }
      const data = await r.json();
      const tasks = data.data || [];
      const matching = tasks.filter((t) => t.group_id === groupId);
      groupTasks.push(...matching);
      if (tasks.length < 200) break;
    }

    if (!groupTasks.length) {
      return res.status(404).json({ error: `No tasks found in group ${groupId}` });
    }

    // Deduplicate and sort by id ascending — take the first
    const seen = new Set();
    const unique = groupTasks
      .filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
      .sort((a, b) => a.id - b.id);

    const first = unique[0];
    res.json({ task_id: first.id, task_name: first.name, group_id: groupId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Execute a task group on a device ─────────────────────────────────────────
// Mirrors Python execute_first_task() / execute_configuration_simple():
//   POST /devices/tasks/groups/{group_id}
//   Body: { device_id: [device_id], tasks: [{ task_id, variables: [] }] }
// No "add device to group" step — that's what was causing RESOURCE_NOT_FOUND
app.post("/api/devices/:deviceId/execute-task", async (req, res) => {
  const { task_group_id, task_id } = req.body;
  const device_id = req.params.deviceId; // RMS device UUID (not serial)

  if (!task_group_id || !task_id) {
    return res.status(400).json({ error: "task_group_id and task_id required" });
  }

  const payload = {
    device_id: [device_id],
    tasks: [{ task_id: task_id, variables: [] }],
  };

  try {
    const r = await fetch(
      `${RMS_BASE}/devices/tasks/groups/${task_group_id}`,
      {
        method: "POST",
        headers: rmsHeaders(),
        body: JSON.stringify(payload),
      }
    );
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Tags ──────────────────────────────────────────────────────────────────────
app.get("/api/tags", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/tags`, { headers: rmsHeaders() });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tags", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/tags`, {
      method: "POST",
      headers: rmsHeaders(),
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/devices/:id/tags", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/devices/${req.params.id}/tags`, {
      method: "POST",
      headers: rmsHeaders(),
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Files (UUID Downloader reads from here) ───────────────────────────────────
app.get("/api/files", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/files`, { headers: rmsHeaders() });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`VivoPoint Config Tool running on :${PORT}`)
);
