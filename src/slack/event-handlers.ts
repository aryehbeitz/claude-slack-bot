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

    // If a query is already running, queue this message for after it finishes
    if (!sessionManager.claimRunning(session.threadKey)) {
      sessionManager.queueMessage(session.threadKey, { channelId, threadTs, text, files, client });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: ':hourglass: Queued — will send after the current query finishes.',
      });
      return;
    }

    // Start streaming message
    await messageQueue.startMessage(session.threadKey, channelId, threadTs);

    // Track full response text for question detection
    let fullResponseText = '';
    // Track tool usage for summary
    const toolUsage: { name: string; detail: string }[] = [];
    // Track AskUserQuestion tool calls
    let pendingQuestionText = '';

    // Run the query
    await queryRunner.run(session, text, {
      onText(textChunk) {
        fullResponseText += textChunk;
        if (config.showStreaming) {
          messageQueue.appendText(session.threadKey, textChunk);
        }
      },

      async onToolUse(toolName, toolInput) {
        toolUsage.push({
          name: toolName,
          detail: (toolInput as any).command || (toolInput as any).file_path || (toolInput as any).pattern || '',
        });

        // Handle AskUserQuestion specially — show as interactive question
        if (toolName === 'AskUserQuestion') {
          const question = (toolInput as any).question || (toolInput as any).prompt || '';
          if (question) {
            pendingQuestionText = question;
          }
        }

        if (config.showToolCalls) {
          await messageQueue.flush(session.threadKey);
          const formatted = formatToolUse(toolName, toolInput);
          await messageQueue.postInThread(session.threadKey, formatted);
        }
      },

      async onToolResult(_toolName, output) {
        if (config.showToolResults && output) {
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

        // Post compact tool summary
        if (config.showToolSummary && toolUsage.length > 0) {
          const counts = new Map<string, number>();
          for (const t of toolUsage) {
            counts.set(t.name, (counts.get(t.name) || 0) + 1);
          }
          const icons: Record<string, string> = {
            Bash: ':computer:', Read: ':page_facing_up:', Write: ':pencil2:',
            Edit: ':pencil:', Glob: ':mag:', Grep: ':mag_right:', Agent: ':robot_face:',
          };
          const parts = Array.from(counts.entries()).map(
            ([name, count]) => `${icons[name] || ':gear:'} ${name} x${count}`
          );
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: parts.join('  |  '),
            blocks: [{
              type: 'context',
              elements: [{ type: 'mrkdwn', text: parts.join('  |  ') }],
            }],
          });
        }

        // Detect questions — from response text or AskUserQuestion tool
        const responseToCheck = resultText || fullResponseText || '';
        let questions = detectQuestions(responseToCheck);

        // If no numbered questions found but AskUserQuestion was used, show it directly
        if (questions.length === 0 && pendingQuestionText) {
          // Try to detect questions from the AskUserQuestion text
          questions = detectQuestions(pendingQuestionText);
        }

        if (questions.length > 0) {
          const { blocks, answerMap } = buildQuestionBlocks(questions, session.threadKey);
          (session as any).pendingAnswers = answerMap;
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'Quick replies:',
            blocks,
          });
        } else if (pendingQuestionText) {
          // AskUserQuestion with free-form question — just post it
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: pendingQuestionText,
            blocks: [
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `:question: ${pendingQuestionText}`.slice(0, 3000) },
              },
              {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: '_Reply in the thread to answer_' }],
              },
            ],
          });
        }
      },

      async onError(error) {
        await messageQueue.error(session.threadKey, error.message || 'Unknown error');
        fileHandler.cleanupTempFiles(processedFiles);
      },
    });

    // Process any queued messages that arrived while running
    const queued = sessionManager.dequeueMessage(session.threadKey);
    if (queued) {
      await handlePrompt(queued.channelId, queued.threadTs, queued.text, queued.files, queued.client);
    }
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
