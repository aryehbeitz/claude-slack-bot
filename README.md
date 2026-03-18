# claude-slack-bot

A Slack bot that lets you send coding tasks to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from your phone, get formatted results back in threads, interactive question buttons, and manage multiple concurrent sessions.

## Features

- **Threaded sessions** -- each Slack thread is an independent Claude Code session with full context
- **Session resume** -- follow-up messages in a thread continue the same Claude session
- **Interactive questions** -- when Claude asks questions, quick-reply buttons appear for easy answers
- **Rich formatting** -- responses use Slack's block kit for proper markdown rendering
- **Tool summary** -- compact summary of tools used (e.g. `Read x4 | Grep x2 | Bash x1`)
- **Working directory** -- set per-channel or per-thread, persisted across restarts
- **File uploads** -- share screenshots or code files for Claude to analyze
- **Slash commands** -- `/cwd`, `/auto`, `/ask`, `/claude-status`, `/stop`
- **Multi-session** -- run concurrent sessions across different threads
- **Socket Mode** -- no public URL needed
- **Configurable output** -- control what appears in Slack via env flags

## Quick Start

### 1. Create Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) -> **Create New App** -> **From a manifest** -> select **JSON** tab -> paste `slack-app-manifest.json`.

Then:
- **OAuth & Permissions** -> Install to workspace -> copy **Bot User OAuth Token** (`xoxb-...`)
- **Basic Information** -> copy **Signing Secret**
- **Basic Information** -> **App-Level Tokens** -> Generate token with `connections:write` scope -> copy (`xapp-...`)

### 2. Authenticate Claude

The bot uses the Claude Agent SDK, which authenticates via your **Claude subscription** (Claude Max, Pro, or Team).

Run the CLI login once on the machine that will host the bot:

```bash
claude login
```

This opens a browser to authenticate with your Claude account. After login, credentials are stored locally and the SDK uses them automatically.

> **Note:** `ANTHROPIC_API_KEY` in `.env` is only needed if you want to use a raw API key instead. Leave it blank if you're using `claude login`.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your tokens:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
DEFAULT_CWD=/path/to/your/projects
```

### 4. Install & Run

```bash
npm install
npm run dev    # Development (auto-reload on file changes)
# or
npm run build && npm start  # Production
```

### 5. Use

- **@mention in a channel** -- `@Claude Code fix the login bug`
- **Reply in thread** -- continue the conversation (no @mention needed)
- **DM the bot** -- send any coding task directly

## Working Directory

Set where Claude operates:

- **Channel default** -- type `/cwd /path/to/project` in a channel. All new threads inherit this path. Persisted across restarts.
- **Per-thread override** -- type `cwd /path/to/other/project` as a message in a thread. Only affects that thread.
- **Inline command** -- also works as `cwd ~/dev/myproject` (no slash).

> **Note:** `/cwd` slash commands don't work inside Slack threads (Slack limitation). Use the inline `cwd` command instead.

## Stopping a Running Query

While Claude is working, you have two reliable ways to stop it:

1. **Stop button** -- a red Stop button appears in the thread while a query is running. Tap it to interrupt immediately.
2. **Emoji reaction** -- react with the stop sign emoji (`:octagonal_sign:`) on any message in the thread. Great from mobile -- long-press a message, tap the stop sign.

After stopping, just type your next message in the thread to start a new query.

## Interactive Questions

When Claude asks numbered questions (e.g. during planning), the bot detects them and posts quick-reply buttons:

- **Yes to all** -- answers yes to every question
- **Per-question buttons** -- each button shows the question topic (e.g. "1. Scope", "3. Error handling")
- **Custom answer** -- type your own response in the thread

## Commands

| Command | Description |
|---|---|
| `/cwd <path>` | Set working directory (channel default outside threads, thread-specific inside) |
| `/auto` | Auto-approve all tool use |
| `/ask` | Require approval for tool use |
| `/claude-status` | Show session info |
| `/stop` | Stop running query |

All commands also work as inline text in messages (e.g. just type `cwd ~/myproject`).

## Configuration

### Required

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Signing secret |

### Optional

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(empty)_ | Not needed if authenticated via `claude login` |
| `DEFAULT_CWD` | _(cwd)_ | Default working directory for new sessions |
| `ALLOWED_USER_IDS` | _(all)_ | Comma-separated Slack user IDs allowed to use the bot |
| `ALLOWED_CHANNEL_IDS` | _(all)_ | Comma-separated channel IDs where the bot responds |
| `SESSION_TIMEOUT_MINUTES` | `30` | Idle session cleanup time |
| `MESSAGE_UPDATE_INTERVAL_MS` | `1500` | How often streaming messages update in Slack |

### Display Flags

Control what appears in Slack threads:

| Variable | Default | Description |
|---|---|---|
| `SHOW_TOOL_CALLS` | `0` | Show each tool call as a separate message (e.g. `:computer: Bash: git status`) |
| `SHOW_TOOL_RESULTS` | `0` | Show tool output (command stdout, file contents) in the thread |
| `SHOW_STREAMING` | `1` | Stream text as Claude types. Set to `0` to only show the final result |
| `SHOW_TOOL_SUMMARY` | `1` | Show a compact summary of tools used after completion |

**Recommended presets:**

```bash
# Clean (default) -- only final result + tool summary + question buttons
# No extra env vars needed

# Verbose -- see everything Claude does
SHOW_TOOL_CALLS=1
SHOW_TOOL_RESULTS=1

# Silent -- just the answer, no extras
SHOW_STREAMING=0
SHOW_TOOL_SUMMARY=0
```

### Debug

| Variable | Description |
|---|---|
| `DEBUG` | Set to `1` for pretty-printed SDK message logging in the console |

Debug mode shows Claude's thinking process in the terminal:

```
● Session started  abc-123
  cwd: /Users/dev/falcon-fe
💭 Let me search for the function...
⚡ Grep  approveRequest
  ↳ Found 4 files
⚡ Read  /Users/.../component.ts
◆ Claude: I found 2 implementations...
✓ Done  2 turns · 5.3s · $0.0234
```

## Error Handling

The bot handles failures gracefully and reports status back to the Slack thread:

| Scenario | What happens |
|---|---|
| **Auth failure** | Error posted with setup instructions |
| **Rate limited (Slack)** | Backs off per `retry_after` header, resumes |
| **Claude CLI not found** | Detected at startup, process exits with instructions |
| **Mid-stream failure** | Stop button cleaned up, error posted in thread |
| **Slack disconnect** | Socket Mode auto-reconnects (built into `@slack/bolt`) |

On startup, the bot runs health checks:
- Verifies `claude` CLI is installed
- Confirms authentication (API key or `claude login`)
- Warns if `DEFAULT_CWD` doesn't exist

## Architecture

```
Slack <-> Socket Mode <-> Bolt App
                           |-- Event Handlers (messages, mentions, reactions)
                           |-- Action Handlers (stop button, question buttons)
                           |-- Slash Commands (/cwd, /auto, /ask, /stop)
                           |-- Session Manager (thread -> session, persisted CWD)
                           |-- Query Runner (Claude Agent SDK, streaming)
                           |-- Question Detector (interactive buttons)
                           |-- Message Queue (throttled Slack updates, blocks)
                           '-- File Handler (upload processing)
```

## Persistence

- **Channel CWD** -- saved to `.bot-state.json`, survives restarts
- **Thread sessions** -- in-memory only, lost on restart (Claude session ID allows resume within the same process)

## License

MIT
