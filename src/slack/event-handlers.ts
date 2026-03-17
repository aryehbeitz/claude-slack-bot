import { App } from '@slack/bolt';
import { SessionManager } from '../claude/session-manager';
import { QueryRunner } from '../claude/query-runner';
import { PermissionHandler } from '../claude/permission-handler';
import { MessageQueue } from './message-queue';
import { FileHandler } from './file-handler';
import { handleInlineCommand } from './commands';
import { formatToolUse } from './formatter';
import { Config } from '../types';

export function registerEventHandlers(
  app: App,
  sessionManager: SessionManager,
  queryRunner: QueryRunner,
  permissionHandler: PermissionHandler,
  messageQueue: MessageQueue,
  fileHandler: FileHandler,
  config: Config
) {
  let botUserId: string | undefined;

  // Resolve bot user ID on startup
  app.client.auth.test().then((res) => {
    botUserId = res.user_id as string;
    console.log(`[events] Bot user ID: ${botUserId}`);
  });

  // Handle direct messages
  app.event('message', async ({ event, client }) => {
    const msg = event as any;

    // Skip bot messages, message_changed, etc.
    if (msg.subtype || msg.bot_id) return;
    if (!msg.text && !msg.files) return;

    // Skip if this is a channel message that doesn't mention the bot
    if (msg.channel_type === 'channel' || msg.channel_type === 'group') {
      if (!msg.text?.includes(`<@${botUserId}>`)) return;
    }

    // Check allowed users
    if (
      config.allowedUserIds.length > 0 &&
      !config.allowedUserIds.includes(msg.user)
    ) {
      return;
    }

    // Check allowed channels
    if (
      config.allowedChannelIds.length > 0 &&
      !config.allowedChannelIds.includes(msg.channel)
    ) {
      return;
    }

    const channelId = msg.channel;
    const threadTs = msg.thread_ts || msg.ts;
    let text = (msg.text || '').replace(`<@${botUserId}>`, '').trim();

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
    if (msg.files?.length) {
      processedFiles = await fileHandler.processFiles(
        msg.files,
        config.slackBotToken
      );
      text += fileHandler.buildPromptAddition(processedFiles);
    }

    if (!text) return;

    // Get or create session
    const session = sessionManager.getOrCreate(channelId, threadTs);

    // Don't run concurrent queries in same thread
    if (session.isRunning) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':warning: A query is already running in this thread. Use `/stop` to cancel it first.',
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

      onToolResult(_toolName, _output) {
        // Tool results are visible in the Claude response, no need to echo
      },

      async onComplete(resultText) {
        if (resultText) {
          messageQueue.appendText(session.threadKey, resultText);
        }
        await messageQueue.complete(session.threadKey);
        fileHandler.cleanupTempFiles(processedFiles);
      },

      async onError(error) {
        await messageQueue.error(
          session.threadKey,
          error.message || 'Unknown error'
        );
        fileHandler.cleanupTempFiles(processedFiles);
      },
    });
  });

  // Handle app_mention events (for channels)
  app.event('app_mention', async ({ event, client }) => {
    const msg = event as any;
    if (msg.bot_id) return;

    const channelId = msg.channel;
    const threadTs = msg.thread_ts || msg.ts;
    const text = (msg.text || '').replace(`<@${botUserId}>`, '').trim();

    if (!text) return;

    // Check allowed users/channels
    if (
      config.allowedUserIds.length > 0 &&
      !config.allowedUserIds.includes(msg.user)
    )
      return;
    if (
      config.allowedChannelIds.length > 0 &&
      !config.allowedChannelIds.includes(channelId)
    )
      return;

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

    const session = sessionManager.getOrCreate(channelId, threadTs);

    if (session.isRunning) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':warning: A query is already running in this thread.',
      });
      return;
    }

    await messageQueue.startMessage(session.threadKey, channelId, threadTs);

    await queryRunner.run(session, text, {
      onText(textChunk) {
        messageQueue.appendText(session.threadKey, textChunk);
      },
      onToolUse(toolName, toolInput) {
        const formatted = formatToolUse(toolName, toolInput);
        messageQueue.postInThread(session.threadKey, formatted).catch(console.error);
      },
      onToolResult() {},
      async onComplete(resultText) {
        if (resultText) {
          messageQueue.appendText(session.threadKey, resultText);
        }
        await messageQueue.complete(session.threadKey);
      },
      async onError(error) {
        await messageQueue.error(session.threadKey, error.message || 'Unknown error');
      },
    });
  });
}
