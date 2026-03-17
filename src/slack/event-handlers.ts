import { App } from '@slack/bolt';
import { SessionManager } from '../claude/session-manager';
import { QueryRunner } from '../claude/query-runner';
import { PermissionHandler } from '../claude/permission-handler';
import { MessageQueue } from './message-queue';
import { FileHandler } from './file-handler';
import { handleInlineCommand } from './commands';
import { formatToolUse } from './formatter';
import { Config } from '../types';

export async function registerEventHandlers(
  app: App,
  sessionManager: SessionManager,
  queryRunner: QueryRunner,
  permissionHandler: PermissionHandler,
  messageQueue: MessageQueue,
  fileHandler: FileHandler,
  config: Config
) {
  // Await bot user ID before registering handlers (#1, #5)
  const authResult = await app.client.auth.test();
  const botUserId = authResult.user_id as string;
  console.log(`[events] Bot user ID: ${botUserId}`);

  /** Shared handler for both message and app_mention events (#15) */
  async function handlePrompt(
    channelId: string,
    threadTs: string,
    rawText: string,
    files: any[] | undefined,
    client: typeof app.client
  ) {
    let text = rawText.replace(`<@${botUserId}>`, '').trim();

    // Handle inline commands
    const cmdResult = handleInlineCommand(
      text,
      channelId,
      threadTs,
      sessionManager,
      config
    );
    if (cmdResult.handled) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: cmdResult.text,
      });
      return;
    }

    // Process attached files
    let processedFiles: Awaited<ReturnType<FileHandler['processFiles']>> = [];
    if (files?.length) {
      processedFiles = await fileHandler.processFiles(files, config.slackBotToken);
      text += fileHandler.buildPromptAddition(processedFiles);
    }

    if (!text) return; // (#9)

    // Get or create session
    const session = sessionManager.getOrCreate(channelId, threadTs);

    // Atomically claim the running slot — eliminates check-then-set race (#3)
    if (!sessionManager.claimRunning(session.threadKey)) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':warning: A query is already running in this thread. Tap the Stop button or react with :octagonal_sign: to cancel it.',
      });
      return;
    }

    // Start streaming message
    await messageQueue.startMessage(session.threadKey, channelId, threadTs);

    // Run the query
    await queryRunner.run(session, text, {
      onText(textChunk) {
        messageQueue.appendText(session.threadKey, textChunk);
      },

      onToolUse(toolName, toolInput) {
        const formatted = formatToolUse(toolName, toolInput);
        messageQueue.postInThread(session.threadKey, formatted).catch(console.error);
      },

      onToolResult(_toolName, _output) {},

      async onComplete(resultText) {
        if (resultText) {
          messageQueue.appendText(session.threadKey, resultText);
        }
        await messageQueue.complete(session.threadKey);
        fileHandler.cleanupTempFiles(processedFiles);
      },

      async onError(error) {
        await messageQueue.error(session.threadKey, error.message || 'Unknown error');
        fileHandler.cleanupTempFiles(processedFiles);
      },
    });
  }

  // Handle direct messages and channel messages
  app.event('message', async ({ event, client }) => {
    const msg = event as any;

    if (msg.subtype || msg.bot_id) return;
    if (!msg.text && !msg.files) return;

    // Skip channel/group messages that don't mention the bot
    if (msg.channel_type === 'channel' || msg.channel_type === 'group') {
      if (!msg.text?.includes(`<@${botUserId}>`)) return;
    }

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(msg.user)) return;
    if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(msg.channel)) return;

    await handlePrompt(msg.channel, msg.thread_ts || msg.ts, msg.text || '', msg.files, client);
  });

  // Handle app_mention events (for channels)
  app.event('app_mention', async ({ event, client }) => {
    const msg = event as any;
    if (msg.bot_id) return;

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(msg.user)) return;
    if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(msg.channel)) return;

    await handlePrompt(msg.channel, msg.thread_ts || msg.ts, msg.text || '', msg.files, client);
  });
}
