import { spawn } from "node:child_process";
import express from "express";
import httpProxy from "http-proxy";
import pg from "pg";

const PUBLIC_PORT = Number.parseInt(process.env.PORT ?? "3100", 10);
const INTERNAL_PORT = Number.parseInt(process.env.INTERNAL_PAPERCLIP_PORT ?? "3199", 10);
const INTERNAL_HOST = "127.0.0.1";
const APP_ROOT = "/app";
const PAPERCLIP_TARGET = `http://${INTERNAL_HOST}:${INTERNAL_PORT}`;

let paperclipProc = null;

function startPaperclip() {
  if (paperclipProc) return;
  const childEnv = {
    ...process.env,
    HOST: INTERNAL_HOST,
    PORT: String(INTERNAL_PORT),
    PAPERCLIP_OPEN_ON_LISTEN: "false",
  };
  paperclipProc = spawn("tsx", ["server/dist/index.js"], {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: "inherit",
  });
  paperclipProc.on("exit", (code, signal) => {
    console.error(`[paperclip] exited code=${code} signal=${signal}`);
    paperclipProc = null;
    setTimeout(() => {
      startPaperclip();
    }, 2000);
  });
}

async function isPaperclipReady() {
  try {
    const res = await fetch(`${PAPERCLIP_TARGET}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const { Client } = pg;
const ONBOARDED_CACHE_TTL_MS = 5 * 60 * 1000;   // once onboarded, trust for 5 min
const NOT_ONBOARDED_CACHE_MS = 10 * 1000;       // when not onboarded, recheck every 10s
let onboardedCache = { value: null, at: 0 };

async function hasInstanceAdmin() {
  const now = Date.now();
  if (onboardedCache.value === true && now - onboardedCache.at < ONBOARDED_CACHE_TTL_MS)
    return true;
  if (onboardedCache.value === false && now - onboardedCache.at < NOT_ONBOARDED_CACHE_MS)
    return false;

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    onboardedCache = { value: false, at: now };
    return false;
  }
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const r = await client.query(
      "SELECT COUNT(*)::int AS count FROM instance_user_roles WHERE role = $1",
      ["instance_admin"],
    );
    const count = r.rows[0]?.count ?? 0;
    const ok = count > 0;
    onboardedCache = { value: ok, at: now };
    return ok;
  } catch {
    onboardedCache = { value: false, at: now };
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function setupHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paperclip Setup</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Inter, system-ui, -apple-system, sans-serif; background:#0d0d0d; color:#d8d8d8; margin:0; padding:32px; line-height:1.5; }
      .card { max-width:720px; margin:0 auto; background:#141414; border:1px solid #2d2d2d; border-radius:12px; padding:32px; }
      h1 { margin:0 0 8px 0; font-size:24px; font-weight:600; color:#fff; }
      .sub { color:#9ca3af; font-size:14px; margin:0 0 24px 0; }
      .row { margin:0 0 20px 0; }
      .row:last-of-type { margin-bottom:0; }
      .label { font-size:13px; color:#9ca3af; margin-bottom:6px; }
      button { background:#262626; color:#fff; border:1px solid #404040; border-radius:8px; padding:10px 16px; font-size:14px; font-weight:500; cursor:pointer; font-family:inherit; }
      button:hover:not(:disabled) { background:#2d2d2d; border-color:#525252; }
      button:disabled { opacity:0.6; cursor:not-allowed; }
      pre, .block { background:#1a1a1a; border:1px solid #2d2d2d; border-radius:8px; padding:12px 14px; font-size:13px; display:block; overflow:auto; margin:0; color:#d8d8d8; }
      pre { font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; }
      .muted { color:#9ca3af; font-size:14px; }
      a { color:#a5b4fc; text-decoration:none; }
      a:hover { text-decoration:underline; }
      .invite-link { display:inline-block; word-break:break-all; font-family:ui-monospace, monospace; font-size:13px; }
      .footer { margin-top:24px; padding-top:16px; border-top:1px solid #2d2d2d; color:#9ca3af; font-size:13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Paperclip Setup</h1>
      <p class="sub">Generate your first admin invite URL to bootstrap this instance.</p>
      <div class="row">
        <div class="label">Status</div>
        <div>Paperclip health: <strong id="health">checking...</strong></div>
      </div>
      <div class="row"><button id="bootstrap">Generate admin invite URL</button></div>
      <div class="row" id="inviteRow" style="display:none;">
        <div class="label">Invite URL</div>
        <a id="invite" href="#" target="_blank" rel="noopener" class="invite-link block"></a>
      </div>
      <div class="row">
        <div class="label">Command output</div>
        <pre id="output">-</pre>
      </div>
      <div class="row muted">After accepting the invite, open <a href="/" target="_blank">Paperclip app</a>.</div>
      <div class="row footer">Template source &amp; support: <a href="https://github.com/Lukem121/paperclip-railway-template" target="_blank" rel="noopener">GitHub</a></div>
    </div>
    <script>
      const healthEl = document.getElementById("health");
      const outputEl = document.getElementById("output");
      const inviteEl = document.getElementById("invite");
      const inviteRow = document.getElementById("inviteRow");
      const button = document.getElementById("bootstrap");

      async function refreshHealth() {
        try {
          const res = await fetch("/setup/api/status");
          const j = await res.json();
          healthEl.textContent = j.paperclipReady ? "ready" : "starting";
        } catch {
          healthEl.textContent = "unreachable";
        }
      }

      button.onclick = async () => {
        button.disabled = true;
        outputEl.textContent = "Generating invite...";
        inviteRow.style.display = "none";
        try {
          const res = await fetch("/setup/api/bootstrap", { method: "POST" });
          const j = await res.json();
          outputEl.textContent = j.output || JSON.stringify(j, null, 2);
          if (j.inviteUrl) {
            inviteEl.href = j.inviteUrl;
            inviteEl.textContent = j.inviteUrl;
            inviteRow.style.display = "block";
          }
        } catch (err) {
          outputEl.textContent = String(err);
        } finally {
          button.disabled = false;
          refreshHealth();
        }
      };

      refreshHealth();
      setInterval(refreshHealth, 5000);
    </script>
  </body>
</html>`;
}

function buildBaseUrl(req) {
  const fromEnv = process.env.BETTER_AUTH_BASE_URL || process.env.PAPERCLIP_PUBLIC_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim().replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PUBLIC_PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function runBootstrap(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn("node", ["/wrapper/template/bootstrap-ceo.mjs"], {
      cwd: "/wrapper",
      env: {
        ...process.env,
        BETTER_AUTH_BASE_URL: baseUrl,
        PAPERCLIP_PUBLIC_URL: baseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("close", (code) => {
      const inviteMatch = out.match(/https?:\/\/[^\s]+\/invite\/[^\s]+/);
      resolve({
        ok: code === 0 || out.includes("instance admin already exists"),
        inviteUrl: inviteMatch ? inviteMatch[0] : null,
        output: out.trim(),
      });
    });
  });
}

const app = express();
const proxy = httpProxy.createProxyServer({
  target: PAPERCLIP_TARGET,
  ws: true,
  changeOrigin: false, // preserve Host/Origin so backend trusts browser origin (Better Auth)
});

// Ensure backend sees public host and protocol for trusted-origin checks
proxy.on("proxyReq", (proxyReq, req) => {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = req.headers["x-forwarded-proto"] ?? (req.socket?.encrypted ? "https" : "http");
  if (host) proxyReq.setHeader("x-forwarded-host", host);
  proxyReq.setHeader("x-forwarded-proto", proto);
});

proxy.on("error", (_err, req, res) => {
  if (res && !res.headersSent) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "paperclip_unavailable", path: req.url }));
  }
});

app.get("/setup", (_req, res) => {
  res.status(200).type("html").send(setupHtml());
});

app.get("/setup/healthz", async (_req, res) => {
  const ready = await isPaperclipReady();
  res.status(200).json({ ok: true, wrapper: "ready", paperclipReady: ready });
});

app.get("/setup/api/status", async (_req, res) => {
  const ready = await isPaperclipReady();
  res.status(200).json({ ok: true, paperclipReady: ready, target: PAPERCLIP_TARGET });
});

app.post("/setup/api/bootstrap", async (req, res) => {
  const baseUrl = buildBaseUrl(req);
  const result = await runBootstrap(baseUrl);
  res.status(result.ok ? 200 : 500).json(result);
});

// If no instance admin yet, send visitors from / to /setup
app.use(async (req, res, next) => {
  const path = (req.path || "/").replace(/\/+$/, "") || "/";
  if (req.method !== "GET" || path !== "/") return next();
  const onboarded = await hasInstanceAdmin();
  if (!onboarded) {
    res.redirect(302, "/setup");
    return;
  }
  next();
});

app.use((req, res) => {
  proxy.web(req, res);
});

const server = app.listen(PUBLIC_PORT, () => {
  console.log(`[wrapper] listening on ${PUBLIC_PORT}, proxying to ${PAPERCLIP_TARGET}`);
});

server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head);
});

startPaperclip();

const shutdown = () => {
  if (paperclipProc) {
    paperclipProc.kill("SIGTERM");
  }
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
