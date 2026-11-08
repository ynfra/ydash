# ydash — Agent Guide

Runs `claude` in a pseudo-terminal and serves it to a browser tab, next to an HTML page that
the inner Claude writes. Everything here serves one constraint: **the user's real, local
`claude` session, unmodified, plus a page — not a re-implementation of Claude Code.**

- `README.md` — what it is and how to run it

## Stack

- Bun ≥ 1.3.5 and TypeScript, ESM, `strict` with `noUncheckedIndexedAccess`
- `Bun.spawn({ terminal })` for the PTY; no `node-pty`, no native modules
- `Bun.serve` for HTTP, SSE and the WebSocket
- Browser: plain DOM; `@wterm/dom` (pinned) from esm.sh, its CSS from jsdelivr
- Assets are imported `with { type: "text" }`, so `bun build --compile` embeds them

`bun install` once (types only), then `make` with no target prints the list.

## Architecture

```
ydash (bun, cwd = $PWD)
  ├─ Bun.spawn(claude --add-dir <ws> --append-system-prompt <INSTRUCTIONS>, terminal)
  │     one PTY per ydash process, shared by every tab; 256 KB replay buffer
  ├─ GET  /            src/index.html (shell)
  ├─ GET  /dash.css    src/dash.css
  ├─ GET  /_ydash      {key, cwd, page}: lets a second `ydash` detect this instance
  ├─ GET  /events      SSE "reload" when anything in <ws> changes (fs.watch on the dir)
  ├─ WS   /pty         {t:"i",d} input, {t:"r",c,r} resize; output as binary frames
  └─ GET  /*           files from <ws> (dash.html + assets), path-confined
```

`<ws>` is `$YDASH_DIR` (default `/tmp/ydash`) + `<slug(basename cwd)>-<sha1(cwd\0name)[0:8]>[-<slug(name)>]`.
The preferred port is `4700 + hash % 300`.

## Conventions

- **Watch the directory, never the file.** Claude's Write tool replaces files via a temp file
  and rename; a per-file watcher misses it, and a filename filter dropped it once.
- **Strip Claude Code session env vars before spawning** (`cleanEnv`). Otherwise an inner
  claude started from inside another session marks itself a child and stops saving transcripts.
- **`--add-dir <ws>`** is what lets the inner claude write `dash.html` without a prompt; keep it.
- **Prompt box sends a bracketed paste** (`ESC[200~ … ESC[201~`) and then `\r` 150 ms later,
  so multi-line text is one message.
- **`.html` imports are typed `HTMLBundle` by `@types/bun`** even with `type: "text"`; cast
  them to `string` (see `src/cli.ts`). `.css` / `.md` are declared in `src/assets.d.ts`.
- The page contract for the inner Claude lives in `src/INSTRUCTIONS.md` (`{{PAGE}}`, `{{DIR}}`
  are substituted). A class added to `dash.css` is invisible to Claude until it is listed there.

## Testing

No LLM needed for the plumbing: `YDASH_CMD` replaces `claude`.

```bash
make build
cd "$(mktemp -d)" && YDASH_CMD="stty size" /path/to/ydash --no-open
# shell / css / page:      curl http://127.0.0.1:<port>/{,dash.css,dash.html}
# PTY size arrives:        WebSocket /pty prints "30 100"
# reload fires on rename:  write dash.html via tmp + mv while `curl -N /events` runs
# second run same folder:  prints "already running"
```

End to end needs one real message: ask the inner Claude to change the `.say` box and watch
the left side reload. `bunx tsc --noEmit` before committing.
