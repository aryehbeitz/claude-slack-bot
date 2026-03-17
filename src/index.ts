import { loadConfig } from './config';
import { createSlackApp } from './slack/app';
import { SessionManager } from './claude/session-manager';
import { QueryRunner } from './claude/query-runner';
import { PermissionHandler } from './claude/permission-handler';
import { MessageQueue } from './slack/message-queue';
import { FileHandler } from './slack/file-handler';
import { registerEventHandlers } from './slack/event-handlers';
import { registerActionHandlers } from './slack/action-handlers';
import { registerSlashCommands } from './slack/commands';
import { execSync } from 'child_process';
import * as fs from 'fs';

/** Verify Claude Code CLI is installed and API key is set before starting */
function runStartupChecks(config: { defaultCwd: string; anthropicApiKey: string }) {
  console.log('[startup] Running health checks...');

  // Check Claude CLI exists
  try {
    const version = execSync('claude --version 2>/dev/null || echo "not found"', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (version === 'not found') {
      console.error(
        '[startup] FATAL: Claude Code CLI not found. Install it:\n' +
          '  npm install -g @anthropic-ai/claude-code'
      );
      process.exit(1);
    }
    console.log(`[startup] Claude CLI: ${version}`);
  } catch {
    console.warn(
      '[startup] WARNING: Could not verify Claude CLI. Continuing anyway...'
    );
  }

  // Check API key is present (not valid — that happens on first query)
  if (!config.anthropicApiKey) {
    console.error(
      '[startup] FATAL: ANTHROPIC_API_KEY is not set. Set it in .env or environment.'
    );
    process.exit(1);
  }
  console.log('[startup] ANTHROPIC_API_KEY: set');

  // Check default working directory exists
  if (!fs.existsSync(config.defaultCwd)) {
    console.warn(
      `[startup] WARNING: Default CWD "${config.defaultCwd}" does not exist. ` +
        'Sessions will fail unless /cwd is used to set a valid path.'
    );
  } else {
    console.log(`[startup] Default CWD: ${config.defaultCwd}`);
  }

  console.log('[startup] Health checks passed.');
}

async function main() {
  console.log('[claude-slack-bot] Starting...');

  const config = loadConfig();

  // Pre-flight checks
  runStartupChecks(config);

  const app = createSlackApp(config);

  // Initialize components
  const sessionManager = new SessionManager(config);
  const permissionHandler = new PermissionHandler(app.client);
  const queryRunner = new QueryRunner(config, sessionManager, permissionHandler);
  const messageQueue = new MessageQueue(
    app.client,
    config.messageUpdateIntervalMs
  );
  const fileHandler = new FileHandler(app.client);

  // Register handlers
  await registerEventHandlers(
    app,
    sessionManager,
    queryRunner,
    permissionHandler,
    messageQueue,
    fileHandler,
    config
  );
  registerActionHandlers(app, permissionHandler, sessionManager, messageQueue);
  registerSlashCommands(app, sessionManager, config);

  // Start the app
  await app.start();
  console.log('[claude-slack-bot] Bot is running! (Socket Mode)');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[claude-slack-bot] Shutting down...');
    sessionManager.destroy();
    await app.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[claude-slack-bot] Fatal error:', err);
  process.exit(1);
});
