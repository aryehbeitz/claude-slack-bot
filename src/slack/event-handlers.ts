import { App } from '@slack/bolt';
import { SessionManager } from '../claude/session-manager';
import { QueryRunner } from '../claude/query-runner';
import { PermissionHandler } from '../claude/permission-handler';
import { MessageQueue } from './message-queue';
import { FileHandler } from './file-handler';
import { handleInlineCommand } from './commands';
import { formatToolUse, formatToolResult } from './formatter';
import { detectQuestions, buildQuestionBlocks } from './question-detector';
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

    // Track full response text for question detection
    let fullResponseText = '';

    // Run the query
    await queryRunner.run(session, text, {
      onText(textChunk) {
        fullResponseText += textChunk;
        messageQueue.appendText(session.threadKey, textChunk);
      },

      async onToolUse(toolName, toolInput) {
        // Flush text buffer first so tool use appears after the text
        await messageQueue.flush(session.threadKey);
        const formatted = formatToolUse(toolName, toolInput);
        await messageQueue.postInThread(session.threadKey, formatted);
      },

      async onToolResult(_toolName, output) {
        if (output) {
          const formatted = formatToolResult(output);
          if (formatted) {
            await messageQueue.postInThread(session.threadKey, formatted);
          }
        }
      },

      async onComplete(resultText) {
        // If we have a clean result text from the SDK, use it as the final message
        if (resultText && resultText.length > 0) {
          messageQueue.setContent(session.threadKey, resultText);
        }
        await messageQueue.complete(session.threadKey);
        fileHandler.cleanupTempFiles(processedFiles);

        // Detect questions and post interactive buttons
        const responseToCheck = resultText || fullResponseText || '';
        const questions = detectQuestions(responseToCheck);
        if (questions.length > 0) {
          const { blocks, answerMap } = buildQuestionBlocks(questions, session.threadKey);
          // Store answer map on session for action handler
          (session as any).pendingAnswers = answerMap;
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'Quick replies:',
            blocks,
          });
        }
      },

      async onError(error) {
        await messageQueue.error(session.threadKey, error.message || 'Unknown error');
        fileHandler.cleanupTempFiles(processedFiles);
      },
    });
  }

  // Track handled messages to avoid duplicate processing from message + app_mention events
  const handledMessages = new Set<string>();

  function dedup(ts: string): boolean {
    if (handledMessages.has(ts)) return true;
    handledMessages.add(ts);
    // Prevent unbounded growth
    if (handledMessages.size > 1000) {
      const arr = Array.from(handledMessages);
      for (let i = 0; i < 500; i++) handledMessages.delete(arr[i]);
    }
    return false;
  }

  // Handle direct messages and channel messages
  app.event('message', async ({ event, client }) => {
    const msg = event as any;

    if (msg.subtype || msg.bot_id) return;
    if (!msg.text && !msg.files) return;

    // Skip channel/group messages that don't mention the bot, unless it's a thread reply to an existing session
    if (msg.channel_type === 'channel' || msg.channel_type === 'group') {
      const isThread = !!msg.thread_ts;
      const hasExistingSession = isThread && sessionManager.get(msg.channel, msg.thread_ts);
      if (!msg.text?.includes(`<@${botUserId}>`) && !hasExistingSession) return;
    }

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(msg.user)) return;
    if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(msg.channel)) return;

    if (dedup(msg.ts)) return;
    await handlePrompt(msg.channel, msg.thread_ts || msg.ts, msg.text || '', msg.files, client);
  });

  // Handle quick-reply button clicks for question answers
  app.action(/^qa_/, async ({ action, ack, body, client: actionClient }) => {
    await ack();
    const actionId = (action as any).action_id;
    const answerValue = (action as any).value;

    // Find the session that has this pending answer
    const channelId = (body as any).channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    if (!channelId || !threadTs) return;

    const session = sessionManager.get(channelId, threadTs);
    if (!session) return;

    const answerMap = (session as any).pendingAnswers as Map<string, string> | undefined;
    const answerText = answerMap?.get(actionId) || answerValue || 'Yes';

    // Delete the buttons message
    try {
      await actionClient.chat.delete({
        channel: channelId,
        ts: (body as any).message.ts,
      });
    } catch {}

    // Post the user's answer as a visible message
    await actionClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `:speech_balloon: ${answerText}`,
    });

    // Clear pending answers
    delete (session as any).pendingAnswers;

    // Feed the answer back to Claude
    await handlePrompt(channelId, threadTs, answerText, undefined, actionClient);
  });

  // Handle app_mention events (for channels)
  app.event('app_mention', async ({ event, client }) => {
    const msg = event as any;
    if (msg.bot_id) return;

    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(msg.user)) return;
    if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(msg.channel)) return;

    if (dedup(msg.ts)) return;
    await handlePrompt(msg.channel, msg.thread_ts || msg.ts, msg.text || '', msg.files, client);
  });
}
