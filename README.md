# ynfra / ydash

Claude Code in a browser tab: the terminal on the right, and on the left an HTML page that
Claude writes and keeps updated as it works. Runs your local `claude` on your own login;
one Bun binary, no npm dependencies at runtime.

## Prerequisites

- `bun` ≥ 1.3.5 (built-in PTY) and `claude` on `PATH`
- macOS or Linux

## Usage

```bash
make ship              # build ./ydash and symlink it into ~/.local/bin

cd ~/some/project
ydash                  # opens http://127.0.0.1:<port> for this folder
ydash release          # a second, named workspace for the same folder
ydash -- --continue    # flags after -- go to claude: resume the last session
ydash -- --resume <id> # resume a specific session
```

## Files

| File | Where | Description |
|---|---|---|
| `dash.html` | `/tmp/ydash/<folder>-<hash>[-name]/` | The page Claude writes; kept across restarts |
| `src/cli.ts` | | Argument parsing, workspace, PTY, HTTP + WebSocket server |
| `src/index.html` | served at `/` | Browser shell: page iframe, wterm terminal, prompt box, comments |
| `src/dash.css` | served at `/dash.css` | Shared dark theme Claude's pages link to |
| `src/INSTRUCTIONS.md` | `--append-system-prompt` | Tells Claude about the page and the comment format |
| `src/welcome.html` | | First content of a new workspace's `dash.html` |

## Notes

- **The port is derived from folder + name**, so the URL stays the same between runs. If it is taken by another program, any free port is used.
- **Running `ydash` again in the same folder** opens the running instance instead of starting a second `claude`.
- **Prompt box:** ⌘↵ sends the whole text as one paste plus Enter; Esc returns focus to the terminal.
- **Select text on the page → Comment** queues `> quote` + your note in the prompt box; send several at once.
- **Ctrl+C in the terminal where `ydash` runs** stops it and the `claude` inside. Reloading the browser re-attaches to the same session.
- **It is a live shell on your machine.** It binds to `127.0.0.1` only; don't proxy it elsewhere.
- **The terminal (wterm) loads from a CDN**, so the first load needs network.

See [AGENTS.md](AGENTS.md) for conventions, internals, and day-2 operations.
