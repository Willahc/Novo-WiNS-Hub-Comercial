// auth.mjs — Autenticação de sessão (cookie HMAC) validando contra /etc/nginx/.htpasswd-winshub
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTPASSWD_PATH = process.env.HTPASSWD_PATH || "/etc/nginx/.htpasswd-winshub";
const SECRET_FILE = path.join(__dirname, ".session-secret");
const COOKIE_NAME = "wins_session";
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const s = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (s.length >= 32) return s;
    }
    const gen = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, gen, { mode: 0o600 });
    return gen;
  } catch {
    return crypto.createHash("sha256").update(process.env.WEBHOOK_SECRET || "winshub-fallback").digest("hex");
  }
}

const SESSION_SECRET = getSessionSecret();
const failedAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now - entry.firstAt > 15 * 60 * 1000) return true;
  return entry.count < 10;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now - entry.firstAt > 15 * 60 * 1000) {
    failedAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip) {
  failedAttempts.delete(ip);
}

export async function verifyHtpasswd(username, password) {
  if (!username || typeof password !== "string" || !fs.existsSync(HTPASSWD_PATH)) return false;
  const lines = fs.readFileSync(HTPASSWD_PATH, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const u = line.slice(0, idx);
    const hash = line.slice(idx + 1).trim();
    if (u !== username) continue;
    if (hash.startsWith("$apr1$")) {
      const parts = hash.split("$");
      const salt = parts[2] || "";
      if (!salt) return false;
      const { stdout } = await execFileAsync("openssl", ["passwd", "-apr1", "-salt", salt, password]);
      const candidate = stdout.trim();
      const a = Buffer.from(candidate);
      const b = Buffer.from(hash);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
  }
  return false;
}

function signToken(username) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.u || !data?.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 16384) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function safeNext(nextUrl) {
  if (!nextUrl || typeof nextUrl !== "string") return "/";
  if (!nextUrl.startsWith("/") || nextUrl.startsWith("//") || nextUrl.startsWith("/login")) return "/";
  return nextUrl;
}

function renderLoginHtml(errorMsg = "", nextUrl = "/") {
  const errHtml = errorMsg
    ? `<div class="err" role="alert">${errorMsg.replace(/[<>&"]/g, "")}</div>`
    : "";
  const safeNextVal = safeNext(nextUrl).replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#151921">
  <title>Entrar — WiNS Hub Comercial</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap">
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;height:100%;font-family:"Geist",system-ui,sans-serif;background:#0f131c;color:#f3f4f6;-webkit-font-smoothing:antialiased}
    body{display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 20% 20%,rgba(61,69,86,.22),transparent 55%),radial-gradient(circle at 80% 80%,rgba(59,130,246,.08),transparent 55%),#0f131c}
    .card{width:100%;max-width:400px;background:linear-gradient(155deg,#2b313d 0%,#1d222b 60%,#252b36 100%);border:1px solid #3d4556;border-radius:16px;padding:30px 26px;box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 20px 50px rgba(0,0,0,.5)}
    .brand{font-family:"Space Grotesk",system-ui,sans-serif;font-size:22px;font-weight:700;letter-spacing:-.025em;background:linear-gradient(180deg,#fff 0%,#cbd5e1 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 6px}
    .sub{font-size:13px;color:#9ca3af;margin:0 0 24px}
    label{display:block;font-size:12px;font-weight:500;color:#cbd5e1;margin-bottom:6px}
    .inp-wrap{position:relative;margin-bottom:16px}
    input{width:100%;height:44px;border-radius:10px;border:1px solid #3d4556;background:#131720;color:#f3f4f6;padding:0 13px;font-size:15px;outline:none;transition:border-color .15s}
    input:focus{border-color:#94a3b8}
    .toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;color:#9ca3af;font-size:12px;cursor:pointer;padding:4px 6px}
    .toggle:hover{color:#fff}
    .btn{width:100%;height:44px;border:0;border-radius:10px;background:linear-gradient(180deg,#f8fafc 0%,#cbd5e1 100%);color:#0f131c;font-size:14px;font-weight:600;cursor:pointer;margin-top:6px;transition:filter .15s}
    .btn:hover{filter:brightness(1.06)}
    .err{background:rgba(239,68,68,.14);border:1px solid rgba(248,113,113,.35);color:#fca5a5;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:16px}
    .foot{margin-top:18px;text-align:center;font-size:11.5px;color:#6b7280}
  </style>
</head>
<body>
  <main class="card">
    <h1 class="brand">WiNS Hub Comercial</h1>
    <p class="sub">Acesse seu painel de prospecção e CRM</p>
    ${errHtml}
    <form method="POST" action="/login">
      <input type="hidden" name="next" value="${safeNextVal}">
      <label for="username">Usuário</label>
      <div class="inp-wrap">
        <input id="username" name="username" type="text" autocomplete="username" required autofocus>
      </div>
      <label for="password">Senha</label>
      <div class="inp-wrap">
        <input id="password" name="password" type="password" autocomplete="current-password" style="padding-right:64px" required>
        <button type="button" class="toggle" id="togPwd">Mostrar</button>
      </div>
      <button type="submit" class="btn">Entrar</button>
    </form>
    <div class="foot">Sessão protegida · WiNS Hub</div>
  </main>
  <script>
    document.getElementById('togPwd').addEventListener('click', function () {
      var p = document.getElementById('password');
      var show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      this.textContent = show ? 'Ocultar' : 'Mostrar';
    });
  </script>
</body>
</html>`;
}

export async function handleAuthRequest(req, res) {
  const urlObj = new URL(req.url || "/", "http://localhost");
  const pathname = urlObj.pathname;

  if (req.method === "GET" && pathname === "/auth/check") {
    const cookies = parseCookies(req);
    if (verifyToken(cookies[COOKIE_NAME])) {
      res.writeHead(200);
      res.end("OK");
      return true;
    }
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Basic ")) {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0 && await verifyHtpasswd(decoded.slice(0, idx), decoded.slice(idx + 1))) {
        res.writeHead(200);
        res.end("OK");
        return true;
      }
    }
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  if (req.method === "GET" && pathname === "/login") {
    const nextUrl = safeNext(urlObj.searchParams.get("next") || "/");
    const cookies = parseCookies(req);
    if (verifyToken(cookies[COOKIE_NAME])) {
      res.writeHead(302, { Location: nextUrl });
      res.end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(renderLoginHtml("", nextUrl));
    return true;
  }

  if (req.method === "POST" && pathname === "/login") {
    const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderLoginHtml("Muitas tentativas seguidas. Aguarde alguns minutos.", "/"));
      return true;
    }
    const raw = await readBody(req).catch(() => "");
    let username = "";
    let password = "";
    let nextUrl = "/";
    if ((req.headers["content-type"] || "").includes("application/json")) {
      try {
        const j = JSON.parse(raw);
        username = String(j.username || "").trim();
        password = String(j.password || "");
        nextUrl = safeNext(j.next);
      } catch {}
    } else {
      const params = new URLSearchParams(raw);
      username = String(params.get("username") || "").trim();
      password = String(params.get("password") || "");
      nextUrl = safeNext(params.get("next"));
    }

    const ok = await verifyHtpasswd(username, password);
    if (!ok) {
      recordFailure(ip);
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderLoginHtml("Usuário ou senha inválidos.", nextUrl));
      return true;
    }

    clearFailures(ip);
    const token = signToken(username);
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${isHttps ? "; Secure" : ""}`;
    res.writeHead(302, { "Set-Cookie": cookie, Location: nextUrl });
    res.end();
    return true;
  }

  if (pathname === "/logout") {
    const isHttps = req.headers["x-forwarded-proto"] === "https";
    const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? "; Secure" : ""}`;
    res.writeHead(302, { "Set-Cookie": cookie, Location: "/login" });
    res.end();
    return true;
  }

  return false;
}
