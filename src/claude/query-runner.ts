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
    try {
      const options: Record<string, unknown> = {
        abortController: session.abortController,
        cwd: session.cwd,
        maxTurns: 50,
        permissionMode: 'bypassPermissions',
      };

      if (session.sessionId) {
        (options as any).resume = session.sessionId;
      }

      let resultText = '';
      // Track streamed content to emit only deltas
      let lastTextLength = 0;
      let lastMessageId = '';
      const seenToolUseIds = new Set<string>();

      const conversation = query({
        prompt,
        options: options as any,
      });

      for await (const message of conversation) {
        const msg = message as any;

        if (process.env.DEBUG) {
          console.log(`[query] ${msg.type}${msg.subtype ? '.' + msg.subtype : ''}`, JSON.stringify(msg).slice(0, 500));
        }

        // Extract session_id for session resume
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.sessionManager.updateSessionId(session.threadKey, msg.session_id);
        }

        // Extract final result
        if (msg.type === 'result') {
          resultText = msg.result || '';
          continue;
        }

        // Process assistant messages — SDK sends full content each time, so we diff
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = msg.message.content;
          if (!Array.isArray(content)) continue;

          // Reset text tracking when a new message starts (new turn after tool use)
          const messageId = msg.message.id || '';
          if (messageId && messageId !== lastMessageId) {
            lastTextLength = 0;
            lastMessageId = messageId;
          }

          // Collect all text blocks into one string to diff against previous
          let fullText = '';
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              fullText += block.text;
            } else if (block.type === 'tool_use' && !seenToolUseIds.has(block.id)) {
              seenToolUseIds.add(block.id);
              callbacks.onToolUse(block.name, block.input || {});
            }
          }

          // Emit only the new text delta
          if (fullText.length > lastTextLength) {
            const delta = fullText.slice(lastTextLength);
            callbacks.onText(delta);
            lastTextLength = fullText.length;
          }
        }

        // Process tool results
        if (msg.type === 'user' && msg.message?.content) {
          const content = Array.isArray(msg.message.content) ? msg.message.content : [];
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
}
