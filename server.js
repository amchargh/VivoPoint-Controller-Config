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
// Paginate through all devices (up to 500)
app.get("/api/devices", async (req, res) => {
  try {
    const all = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const r = await fetch(
        `${RMS_BASE}/devices?offset=${offset}&limit=100`,
        { headers: rmsHeaders() }
      );
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

// Single device detail (includes mobile_ip, tags, status)
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

// Device task history
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

// ── Task Groups (Profiles) ────────────────────────────────────────────────────
app.get("/api/task-groups", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/devices/tasks/groups`, {
      headers: rmsHeaders(),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute a task group on a device
app.post("/api/devices/:deviceId/configure", async (req, res) => {
  const { task_group_id, device_serial } = req.body;
  if (!task_group_id || !device_serial) {
    return res.status(400).json({ error: "task_group_id and device_serial required" });
  }
  try {
    // Add device to task group
    const addR = await fetch(
      `${RMS_BASE}/devices/tasks/groups/${task_group_id}/devices`,
      {
        method: "POST",
        headers: rmsHeaders(),
        body: JSON.stringify({ serials: [device_serial] }),
      }
    );
    if (!addR.ok) {
      const t = await addR.text();
      return res.status(addR.status).json({ error: `Failed to add device: ${t}` });
    }

    // Execute task group
    const execR = await fetch(
      `${RMS_BASE}/devices/tasks/groups/${task_group_id}`,
      {
        method: "POST",
        headers: rmsHeaders(),
        body: JSON.stringify({
          tasks: [{ name: "execute", data: [{ serial: device_serial }] }],
        }),
      }
    );
    const execData = await execR.json();
    res.status(execR.status).json(execData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Networks ──────────────────────────────────────────────────────────────────
app.get("/api/networks", async (req, res) => {
  try {
    const r = await fetch(`${RMS_BASE}/networks`, { headers: rmsHeaders() });
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

// ── Files (for UUID downloader) ───────────────────────────────────────────────
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
    // Return raw text — the UUID file is plain text
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
app.listen(PORT, () => console.log(`VivoPoint Config Tool running on :${PORT}`));
