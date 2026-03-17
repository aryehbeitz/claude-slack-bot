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

async function main() {
  console.log('[claude-slack-bot] Starting...');

  const config = loadConfig();
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
  registerEventHandlers(
    app,
    sessionManager,
    queryRunner,
    permissionHandler,
    messageQueue,
    fileHandler,
    config
  );
  registerActionHandlers(app, permissionHandler);
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
