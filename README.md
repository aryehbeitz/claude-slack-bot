# claude-slack-bot

A Slack bot that lets you send coding tasks to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) from your phone, get streaming results back in threads, approve tool use via interactive buttons, and manage multiple concurrent sessions.

## Features

- **Threaded sessions** — each Slack thread is an independent Claude Code session with full context
- **Streaming responses** — watch Claude think and respond in real-time
- **Permission control** — approve/deny tool use (file edits, bash commands) via buttons
- **Ask & Auto modes** — toggle between requiring approval and auto-running tools
- **File uploads** — share screenshots or code files for Claude to analyze
- **Slash commands** — `/cwd`, `/auto`, `/ask`, `/status`, `/stop`
- **Multi-session** — run concurrent sessions across different threads
- **Socket Mode** — no public URL needed

## Quick Start

### 1. Create Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest** → paste `slack-app-manifest.yaml`.

Then:
- **OAuth & Permissions** → Install to workspace → copy **Bot User OAuth Token** (`xoxb-...`)
- **Basic Information** → copy **Signing Secret**
- **Basic Information** → **App-Level Tokens** → Generate token with `connections:write` scope → copy (`xapp-...`)

### 2. Get Anthropic API Key

The bot uses the Claude Code CLI, which authenticates via your **Claude subscription** (Claude Max or Claude Pro), not a pay-per-token API key.

Run the CLI login once on the machine that will host the bot:

```bash
claude login
```

This opens a browser to authenticate with your Claude account. After login, credentials are stored locally and the CLI uses them automatically.

> **Note:** `ANTHROPIC_API_KEY` in `.env` is only needed if you want to use a raw Anthropic API key instead. Leave it blank if you're using `claude login`.

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your tokens:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_APP_TOKEN=xapp-...
#   SLACK_SIGNING_SECRET=...
#   DEFAULT_CWD=/path/to/your/projects
# ANTHROPIC_API_KEY is not needed if you ran `claude login`
```

### 4. Install & Run

```bash
npm install
npm run dev    # Development (tsx, auto-reload)
# or
npm run build && npm start  # Production
```

### 5. Use

- **DM the bot** — send any coding task
- **@mention in a channel** — `@Claude Code fix the login bug`
- **Reply in thread** — continue the conversation with full context

## Interrupting a Running Query

While Claude is working, you have three ways to stop it — just like pressing Esc or Ctrl+C in a terminal:

1. **Stop button** — A red Stop button appears in the thread whenever a query is running. Tap it to interrupt immediately. The button disappears when the query finishes.
2. **Emoji reaction** — React with :octagonal_sign: (`:octagonal_sign:`) on any message in the thread. Great from mobile — long-press a message, tap the stop sign emoji.
3. **Slash command** — Type `/stop` in the thread.

## Commands

| Command | Description |
|---|---|
| `/cwd <path>` | Set working directory |
| `/auto` | Auto-approve all tool use |
| `/ask` | Require approval for tool use |
| `/claude-status` | Show session info |
| `/stop` | Stop running query |

Commands also work as inline text in messages (e.g., just type `cwd ~/myproject`).

## Permissions

In **ask mode** (default), Claude will post an interactive message with Approve/Deny buttons before running tools like Bash, Edit, or Write. In **auto mode**, all tools execute immediately.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App token for Socket Mode (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Yes | Signing secret |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key — not needed if authenticated via `claude login` |
| `DEFAULT_CWD` | No | Default working directory |
| `ALLOWED_USER_IDS` | No | Comma-separated allowed Slack user IDs |
| `ALLOWED_CHANNEL_IDS` | No | Comma-separated allowed channel IDs |
| `SESSION_TIMEOUT_MINUTES` | No | Idle session cleanup (default: 30) |
| `MESSAGE_UPDATE_INTERVAL_MS` | No | Streaming update interval (default: 1500) |

## Error Handling

The bot handles failures gracefully and always reports status back to the Slack thread:

| Scenario | What happens |
|---|---|
| **Invalid API key / auth failure** | :key: Error posted with setup instructions. No retry. |
| **Rate limited (Anthropic)** | :hourglass: Auto-retries up to 2x with exponential backoff. |
| **Rate limited (Slack)** | Backs off per `retry_after` header, resumes streaming. |
| **Internet outage / network error** | :cloud: Auto-retries. If all retries fail, error posted. |
| **API credits exhausted** | :credit_card: Error posted with link to Anthropic console. |
| **Context too long** | :scroll: Suggests starting a new thread. |
| **Claude CLI not installed** | :wrench: Detected at startup — process exits with install instructions. |
| **API overloaded (529)** | :fire: Auto-retries. Error posted if persistent. |
| **Slack disconnect** | Socket Mode auto-reconnects (built into `@slack/bolt`). |
| **Mid-stream failure** | Stop button cleaned up, error posted, hourglass swapped for :x:. |

On startup, the bot runs health checks:
- Verifies `claude` CLI is installed
- Confirms `ANTHROPIC_API_KEY` is set
- Warns if `DEFAULT_CWD` doesn't exist

## Architecture

```
Slack ←→ Socket Mode ←→ Bolt App
                           ├── Event Handlers (messages, mentions)
                           ├── Action Handlers (approve/deny buttons)
                           ├── Slash Commands
                           ├── Session Manager (thread → session mapping)
                           ├── Query Runner (Claude Code SDK)
                           ├── Permission Handler (interactive prompts)
                           ├── Message Queue (throttled streaming updates)
                           └── File Handler (upload processing)
```

## License

MIT
