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

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your tokens:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_APP_TOKEN=xapp-...
#   SLACK_SIGNING_SECRET=...
#   ANTHROPIC_API_KEY=sk-ant-...
#   DEFAULT_CWD=/path/to/your/projects
```

### 3. Install & Run

```bash
npm install
npm run dev    # Development (tsx, auto-reload)
# or
npm run build && npm start  # Production
```

### 4. Use

- **DM the bot** — send any coding task
- **@mention in a channel** — `@Claude Code fix the login bug`
- **Reply in thread** — continue the conversation with full context

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
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `DEFAULT_CWD` | No | Default working directory |
| `ALLOWED_USER_IDS` | No | Comma-separated allowed Slack user IDs |
| `ALLOWED_CHANNEL_IDS` | No | Comma-separated allowed channel IDs |
| `SESSION_TIMEOUT_MINUTES` | No | Idle session cleanup (default: 30) |
| `MESSAGE_UPDATE_INTERVAL_MS` | No | Streaming update interval (default: 1500) |

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
