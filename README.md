# VivoPoint Dynamic Controller Configuration Tool

Web-based replacement for the Tkinter desktop app. Built with Node.js/Express, deployable to Railway in one click. The RMS API token lives server-side as an environment variable — it is never exposed to the browser.

## Features

- **Profile Discovery** — fetches task groups and networks live from the Teltonika RMS API
- **Device Selection** — paginated device list (up to 500), fuzzy search by name or serial, already-configured detection via RMS tags
- **Controller Configuration** — adds device to task group and executes it via RMS API; locks device from re-configuration
- **URL Builder** — auto-generates `http://<mobile-ip>:<port>` from controller IP range mappings
- **Property Tag** — creates and assigns RMS tags to devices
- **Device Info** — pulls full device detail: status, mobile IP, IMEI, firmware, signal, operator, tags
- **VivoPoint section** — Body of Water selector + UUID display (shown post-configuration)

## Supported Controllers

| Controller | Internal IP Range | Ports |
|---|---|---|
| Walchem / Walchem DualBody | 10.10.6.106–110 | 8585–8589 |
| Chemtrol | 192.168.1.24–28 | 8585–8589 |
| BECs | 10.10.6.131–135 | 8585–8589 |
| ABB VFD | 10.10.6.106–110 | 8585–8589 |
| Prominent | 10.10.6.106–110 | 8585–8589 |

## Deploy to Railway

1. Push this repo to GitHub
2. New project → Deploy from GitHub repo
3. Add environment variable:
   ```
   RMS_API_TOKEN=<your Teltonika RMS JWT token>
   ```
4. Railway auto-detects Node.js and runs `npm start`

## Local Development

```bash
cp .env.example .env
# Add your RMS token to .env
npm install
npm run dev   # nodemon auto-reload on :3000
```

## Architecture

```
Browser  ──fetch──▶  /api/*  (Express, Railway)  ──Bearer──▶  RMS API
                       ▲
                  RMS_API_TOKEN
                  (env var, never in browser)
```

All RMS calls are proxied through `server.js`. The frontend only ever talks to `/api/*` on the same origin.

## API Routes (server.js)

| Method | Path | Description |
|---|---|---|
| GET | /api/health | Token check |
| GET | /api/devices | All devices (paginated) |
| GET | /api/devices/:id | Single device detail |
| GET | /api/devices/:id/tasks/history | Task history |
| POST | /api/devices/:id/configure | Add to group + execute |
| GET | /api/task-groups | All task groups |
| GET | /api/networks | All networks |
| GET | /api/tags | All tags |
| POST | /api/tags | Create tag |
| POST | /api/devices/:id/tags | Assign tag to device |
