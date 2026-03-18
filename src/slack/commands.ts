import { SessionManager } from '../claude/session-manager';
import { Config } from '../types';

export interface CommandResult {
  text: string;
  handled: boolean;
}

/** Check if text starts with a command and handle it */
export function handleInlineCommand(
  text: string,
  channelId: string,
  threadTs: string,
  sessionManager: SessionManager,
  config: Config
): CommandResult {
  const trimmed = text.trim();

  // /cwd or cwd <path>
  const cwdMatch = trimmed.match(/^\/?(cwd)\s+(.+)$/i);
  if (cwdMatch) {
    const newCwd = cwdMatch[2].trim();
    // Always set channel default so new threads pick it up
    sessionManager.setChannelCwd(channelId, newCwd);
    // Also set on current thread session
    const session = sessionManager.getOrCreate(channelId, threadTs);
    sessionManager.setCwd(session.threadKey, newCwd);
    return {
      text: `:file_folder: Working directory set to \`${newCwd}\``,
      handled: true,
    };
  }

  // /auto
  if (/^\/?auto$/i.test(trimmed)) {
    const session = sessionManager.getOrCreate(channelId, threadTs);
    sessionManager.setMode(session.threadKey, 'auto');
    return {
      text: ':zap: Switched to *auto* mode — tools will run without asking for approval.',
      handled: true,
    };
  }

  // /ask
  if (/^\/?ask$/i.test(trimmed)) {
    const session = sessionManager.getOrCreate(channelId, threadTs);
    sessionManager.setMode(session.threadKey, 'ask');
    return {
      text: ':lock: Switched to *ask* mode — tool use requires approval.',
      handled: true,
    };
  }

  // /status
  if (/^\/?status$/i.test(trimmed)) {
    const session = sessionManager.get(channelId, threadTs);
    if (!session) {
      return { text: 'No active session in this thread.', handled: true };
    }
    const lines = [
      `:information_source: *Session Status*`,
      `• *CWD:* \`${session.cwd}\``,
      `• *Mode:* ${session.mode === 'auto' ? ':zap: auto' : ':lock: ask'}`,
      `• *Running:* ${session.isRunning ? 'Yes' : 'No'}`,
      `• *Session ID:* ${session.conversationId || 'none'}`,
    ];
    return { text: lines.join('\n'), handled: true };
  }

  // /stop
  if (/^\/?stop$/i.test(trimmed)) {
    const session = sessionManager.get(channelId, threadTs);
    if (!session) {
      return { text: 'No active session in this thread.', handled: true };
    }
    const aborted = sessionManager.abort(session.threadKey);
    return {
      text: aborted
        ? ':stop_sign: Query stopped.'
        : 'No running query to stop.',
      handled: true,
    };
  }

  return { text: '', handled: false };
}

/** Register slash commands with Bolt app */
export function registerSlashCommands(
  app: any,
  sessionManager: SessionManager,
  config: Config
) {
  app.command('/cwd', async ({ command, ack, respond }: any) => {
    await ack();
    const newCwd = command.text.trim() || config.defaultCwd;
    if (command.thread_ts) {
      // In a thread: set CWD for this thread's session
      const session = sessionManager.getOrCreate(command.channel_id, command.thread_ts);
      sessionManager.setCwd(session.threadKey, newCwd);
      await respond(`:file_folder: Thread working directory set to \`${newCwd}\``);
    } else {
      // In channel: set default CWD for all new sessions in this channel
      sessionManager.setChannelCwd(command.channel_id, newCwd);
      await respond(`:file_folder: Channel default working directory set to \`${newCwd}\``);
    }
  });

  app.command('/auto', async ({ command, ack, respond }: any) => {
    await ack();
    const threadTs = command.thread_ts || command.ts;
    const session = sessionManager.getOrCreate(command.channel_id, threadTs);
    sessionManager.setMode(session.threadKey, 'auto');
    await respond(':zap: Switched to *auto* mode.');
  });

  app.command('/ask', async ({ command, ack, respond }: any) => {
    await ack();
    const threadTs = command.thread_ts || command.ts;
    const session = sessionManager.getOrCreate(command.channel_id, threadTs);
    sessionManager.setMode(session.threadKey, 'ask');
    await respond(':lock: Switched to *ask* mode.');
  });

  app.command('/claude-status', async ({ command, ack, respond }: any) => {
    await ack();
    const threadTs = command.thread_ts || command.ts;
    const session = sessionManager.get(command.channel_id, threadTs);
    if (!session) {
      await respond('No active session.');
      return;
    }
    await respond(
      [
        `:information_source: *Session Status*`,
        `• CWD: \`${session.cwd}\``,
        `• Mode: ${session.mode}`,
        `• Running: ${session.isRunning}`,
      ].join('\n')
    );
  });

  app.command('/stop', async ({ command, ack, respond }: any) => {
    await ack();
    const threadTs = command.thread_ts || command.ts;
    const session = sessionManager.get(command.channel_id, threadTs);
    if (session) {
      sessionManager.abort(session.threadKey);
      await respond(':stop_sign: Query stopped.');
    } else {
      await respond('No active session.');
    }
  });
}
