#!/usr/bin/env bun
// ydash: a Claude-authored page (left) + claude in a web terminal (right),
// for the current folder. The page lives in /tmp/ydash/<folder>-<hash>[-name]/dash.html.
import { basename, join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, watch } from "node:fs";
import shellRaw from "./index.html" with { type: "text" };
import dashCss from "./dash.css" with { type: "text" };
import welcomeRaw from "./welcome.html" with { type: "text" };
import instructionsMd from "./INSTRUCTIONS.md" with { type: "text" };

// Bun types every .html import as an HTMLBundle; with type "text" it is a string.
const shellHtml = shellRaw as unknown as string;
const welcomeHtml = welcomeRaw as unknown as string;

const HELP = `ydash — Claude in a browser terminal, next to a page it writes for you

Usage:
  ydash [name] [options] [-- <claude args>]

Arguments:
  name              optional; a separate workspace (own page, port and claude) for the same folder
  -- <claude args>  everything after -- is passed to claude unchanged

Options:
  -p, --port <n>    port (default: derived from folder + name, else any free one)
      --no-open     don't open the browser
  -h, --help        this help

Examples:
  ydash                          # workspace for $PWD
  ydash release                  # a second, named workspace for $PWD
  ydash -- --continue            # resume the last claude conversation in $PWD
  ydash -- --resume <session-id> # resume a specific conversation
  ydash -- --model opus          # any claude flag works the same way

Behaviour:
  Runs in the foreground until stopped: Ctrl+C or the Stop button in the browser.
  Running it again in the same folder opens the running instance and waits for it to stop.
  The page lives in $YDASH_DIR (default /tmp/ydash)/<folder>-<hash>[-name]/dash.html
  and survives restarts. YDASH_CMD replaces "claude" (for testing).`;

// ---------- args ----------
const argv = Bun.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep === -1 ? argv : argv.slice(0, sep);
const claudeArgs = sep === -1 ? [] : argv.slice(sep + 1);
let name = "";
let port: number | undefined;
let open = true;
for (let i = 0; i < own.length; i++) {
  const a = own[i]!;
  if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
  else if (a === "--no-open") open = false;
  else if (a === "-p" || a === "--port") port = Number(own[++i]);
  else if (!a.startsWith("-") && !name) name = a;
  else { console.error(`ydash: unknown argument ${a}\n\n${HELP}`); process.exit(2); }
}

// ---------- workspace ----------
const CWD = process.cwd();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
const hash = createHash("sha1").update(CWD + "\0" + name).digest("hex");
const key = `${slug(basename(CWD))}-${hash.slice(0, 8)}${name ? "-" + slug(name) : ""}`;
const DIR = join(process.env.YDASH_DIR ?? "/tmp/ydash", key);
const PAGE = join(DIR, "dash.html");
mkdirSync(DIR, { recursive: true });
if (!existsSync(PAGE)) writeFileSync(PAGE, welcomeHtml);

// ---------- claude in a PTY ----------
const CMD = (process.env.YDASH_CMD ?? "claude").split(" ");
const MAX_BUF = 256 * 1024; // replay buffer so a browser reload repaints the terminal
type Proc = ReturnType<typeof Bun.spawn>;
let proc: Proc | null = null;
let buf: Uint8Array[] = [];
let bufLen = 0;
let size = { cols: 100, rows: 30 };
const clients = new Set<{ send(d: Uint8Array): unknown }>();

function push(chunk: Uint8Array) {
  buf.push(chunk);
  bufLen += chunk.length;
  while (bufLen > MAX_BUF && buf.length > 1) bufLen -= buf.shift()!.length;
  for (const ws of clients) ws.send(chunk);
}

// If ydash itself runs inside a Claude Code session, don't let the inner claude
// think it's a child session (that disables transcript saving).
function cleanEnv() {
  const env: Record<string, string | undefined> = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
  const sessionVar = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|CHILD_SESSION|SSE_PORT|SESSION_\w+|MESSAGING_\w+))$/;
  for (const k of Object.keys(env)) if (sessionVar.test(k)) delete env[k];
  return env;
}

function command() {
  if (basename(CMD[0]!) !== "claude") return [...CMD, ...claudeArgs];
  const instructions = instructionsMd.replaceAll("{{PAGE}}", PAGE).replaceAll("{{DIR}}", DIR);
  // --add-dir lets claude write the page without a permission prompt.
  return [...CMD, "--add-dir", DIR, "--append-system-prompt", instructions, ...claudeArgs];
}

function ensureProc() {
  if (proc) return;
  buf = [];
  bufLen = 0;
  proc = Bun.spawn(command(), {
    cwd: CWD,
    env: cleanEnv(),
    terminal: { cols: size.cols, rows: size.rows, data: (_t, d) => push(new Uint8Array(d)) },
  });
  proc.exited.then((code) => {
    push(new TextEncoder().encode(`\r\n\x1b[33m[${CMD[0]} exited (${code}) — reload the page to start a new session]\x1b[0m\r\n`));
    proc = null;
  });
}

// ---------- live reload ----------
// Watch the dir, not the file: writers often replace files via temp file + rename.
const events = new Set<ReadableStreamDefaultController>();
let timer: ReturnType<typeof setTimeout> | undefined;
watch(DIR, () => {
  clearTimeout(timer);
  timer = setTimeout(() => { for (const c of events) c.enqueue("data: reload\n\n"); }, 150);
});

function stop() { proc?.kill(); process.exit(0); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// ---------- server ----------
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

function serve(p: number) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: p,
    idleTimeout: 0, // keep SSE open
    async fetch(req, srv) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/": return html(shellHtml);
        case "/dash.css": return new Response(dashCss, { headers: { "Content-Type": "text/css; charset=utf-8" } });
        case "/_ydash": return Response.json({ key, cwd: CWD, page: PAGE });
        case "/_stop": {
          // Same-origin POST only: a random website must not be able to kill the session.
          if (req.method !== "POST" || req.headers.get("origin") !== url.origin) return new Response("forbidden", { status: 403 });
          setTimeout(stop, 200); // let the response flush first
          return Response.json({ ok: true });
        }
        case "/pty": return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
        case "/events": {
          let ctrl: ReadableStreamDefaultController;
          const stream = new ReadableStream({
            start(c) { ctrl = c; events.add(c); c.enqueue(": hi\n\n"); },
            cancel() { events.delete(ctrl); },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
        }
      }
      // Anything else comes from the workspace dir (dash.html and its assets).
      const path = normalize(join(DIR, decodeURIComponent(url.pathname)));
      if (!path.startsWith(DIR + "/")) return new Response("forbidden", { status: 403 });
      const file = Bun.file(path);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "Cache-Control": "no-store" } });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ensureProc();
        for (const chunk of buf) ws.send(chunk);
      },
      message(_ws, msg) {
        // Protocol: JSON {t:"i", d:"..."} for input, {t:"r", c, r} for resize.
        const m = JSON.parse(String(msg));
        if (!proc?.terminal) return;
        if (m.t === "i") proc.terminal.write(m.d);
        else if (m.t === "r" && m.c > 0 && m.r > 0) {
          size = { cols: m.c, rows: m.r };
          proc.terminal.resize(m.c, m.r);
        }
      },
      close(ws) { clients.delete(ws); },
    },
  });
}

function openBrowser(url: string) {
  if (!open) return;
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], { stdout: "ignore", stderr: "ignore" });
}

// Same folder + name gets the same port, so the URL is stable. If that port is
// taken by this very workspace, just reopen it; if by something else, pick any.
const preferred = port ?? 4700 + (parseInt(hash.slice(0, 6), 16) % 300);
let server: ReturnType<typeof serve>;
try {
  server = serve(preferred);
} catch {
  const running = await fetch(`http://127.0.0.1:${preferred}/_ydash`).then((r) => r.json()).catch(() => null) as { key?: string } | null;
  if (running?.key === key) {
    const url = `http://127.0.0.1:${preferred}`;
    console.log(`ydash: already running for this workspace → ${url}\n  waiting until it stops (Ctrl+C to detach)`);
    openBrowser(url);
    // Stay blocked like the first instance would, so a caller waiting on ydash behaves the same either way.
    while (await fetch(`${url}/_ydash`).then((r) => r.ok, () => false)) await Bun.sleep(1000);
    console.log("ydash: stopped");
    process.exit(0);
  }
  if (port) { console.error(`ydash: port ${port} is in use`); process.exit(1); }
  server = serve(0);
}

const url = `http://127.0.0.1:${server.port}`;
console.log(`ydash  ${url}\n  cwd   ${CWD}\n  page  ${PAGE}\n  Ctrl+C stops ydash and the claude inside it`);
openBrowser(url);

