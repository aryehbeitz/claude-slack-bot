import { query, type MessageEvent } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSession, Config } from '../types';
import { PermissionHandler } from './permission-handler';
import { SessionManager } from './session-manager';
import { classifyError } from '../utils/errors';

export interface QueryCallbacks {
  onText: (text: string) => void;
  onToolUse: (toolName: string, toolInput: Record<string, unknown>) => void;
  onToolResult: (toolName: string, output: string) => void;
  onComplete: (resultText: string) => void;
  onError: (error: Error) => void;
}

export class QueryRunner {
  constructor(
    private config: Config,
    private sessionManager: SessionManager,
    private permissionHandler: PermissionHandler
  ) {}

  async run(
    session: ClaudeSession,
    prompt: string,
    callbacks: QueryCallbacks
  ): Promise<void> {
    // claimRunning() was called by the caller before the first await — don't call setRunning(true) here
    try {
      const options: Record<string, unknown> = {
        abortController: session.abortController,
        cwd: session.cwd,
        maxTurns: 50,
        permissionMode: 'bypassPermissions',
      };

      if (session.conversationId) {
        (options as any).resume = true;
        (options as any).conversationId = session.conversationId;
      }

      let resultText = '';

      const conversation = query({
        prompt,
        options: options as any,
      });

      for await (const message of conversation) {
        const msg = message as any;

        // Extract conversationId for session resume
        if (msg.type === 'system' && msg.subtype === 'init') {
          const convId = msg.conversationId || msg.session_id;
          if (convId) {
            this.sessionManager.updateConversationId(session.threadKey, convId);
          }
        }

        // Extract final result
        if (msg.type === 'result') {
          resultText = msg.result || '';
        }

        this.processMessage(message, session, callbacks);
      }

      callbacks.onComplete(resultText);
    } catch (err: any) {
      const classified = classifyError(err);
      console[classified.logLevel](
        `[query-runner] ${classified.emoji} ${classified.userMessage}`,
        err?.message || err
      );
      callbacks.onError(
        new Error(`${classified.emoji} ${classified.userMessage}`)
      );
    } finally {
      this.sessionManager.setRunning(session.threadKey, false);
    }
  }

  private processMessage(
    message: MessageEvent,
    session: ClaudeSession,
    callbacks: QueryCallbacks
  ) {
    const msg = message as any;

    if (msg.type === 'assistant' && msg.content) {
      const content = Array.isArray(msg.content) ? msg.content : [msg.content];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          callbacks.onText(block.text);
        } else if (block.type === 'tool_use') {
          callbacks.onToolUse(block.name, block.input || {});
        }
      }
    } else if (msg.type === 'tool_result' || msg.type === 'user') {
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const block of content) {
        if (block.type === 'tool_result') {
          const output =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          callbacks.onToolResult(block.tool_use_id || 'unknown', output);
        }
      }
    }
  }
}
