# AGY Router Desktop

> **Multi-Session AI Gateway & LLM Router Analytics** — Desktop Edition

Lightweight Electron desktop application for monitoring AGY Router telemetry, AI model routing, and token usage analytics.

## Features

- **Real-time SSE streaming** with auto-poll fallback
- **Bento grid metrics** — Total Requests, Input/Output/Cached Tokens, Estimated Cost
- **Dynamic Topology Matrix** — Live AI model status tracking
- **Transaction Ledger** — Filterable activity stream with session & model filters
- **Currency toggle** — USD / IDR conversion
- **Custom frameless window** with native-feel titlebar
- **Window state persistence** — Remembers size and position

## Quick Start

```bash
# Install dependencies
npm install

# Run the desktop app
npm start
```

## Build Portable .exe

```bash
# Install electron-builder
npm install electron-builder --save-dev

# Build portable Windows executable
npm run build
```

## Security

- `nodeIntegration` disabled, `contextIsolation` enabled
- Sandboxed renderer process
- Content Security Policy (CSP) enforced
- HTTPS-only API communication
- Secure DOM manipulation (no innerHTML with user data)
- Window state stored in app user data directory

## Project Structure

```
AGY ROUTER/
├── main.js          # Electron main process
├── preload.js       # IPC bridge (contextBridge)
├── renderer/
│   ├── index.html   # Dashboard UI
│   ├── styles.css   # Neo-brutalist design system
│   └── app.js       # Client application logic
├── assets/
│   └── icon.png     # Application icon
└── package.json     # Project configuration
```

## Default Credentials

- **Username:** `admin`
- **Password:** `mori@gateway2026`
- **Server:** `https://agy.shipr.my.id`
