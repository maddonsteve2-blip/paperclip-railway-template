import { spawn } from "node:child_process";
import express from "express";
import httpProxy from "http-proxy";

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

function setupHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paperclip Setup</title>
    <style>
      body { font-family: Inter, system-ui, Arial, sans-serif; background:#0b1020; color:#e5e7eb; margin:0; padding:24px; }
      .card { max-width:900px; margin:0 auto; background:#111827; border:1px solid #1f2937; border-radius:12px; padding:20px; }
      h1 { margin-top:0; font-size:28px; }
      .row { margin:12px 0; }
      button { background:#2563eb; color:white; border:none; border-radius:8px; padding:10px 14px; cursor:pointer; }
      button:disabled { opacity:.6; cursor:not-allowed; }
      code, pre { background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:10px; display:block; overflow:auto; }
      .muted { color:#9ca3af; }
      a { color:#93c5fd; }
      .invite-link { display:inline-block; word-break:break-all; font-family:monospace; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Paperclip Setup</h1>
      <p class="muted">Use this page to generate your first admin invite URL.</p>
      <div class="row">Paperclip health: <strong id="health">checking...</strong></div>
      <div class="row"><button id="bootstrap">Generate admin invite URL</button></div>
      <div class="row" id="inviteRow" style="display:none;">
        <div>Invite URL</div>
        <a id="invite" href="#" target="_blank" rel="noopener" class="invite-link"></a>
      </div>
      <div class="row">
        <div>Command output</div>
        <pre id="output">-</pre>
      </div>
      <div class="row muted">After accepting invite, open <a href="/" target="_blank">Paperclip app</a>.</div>
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
  changeOrigin: true,
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
