import { query, type MessageEvent } from '@anthropic-ai/claude-code';
import { ClaudeSession, Config } from '../types';
import { PermissionHandler } from './permission-handler';
import { SessionManager } from './session-manager';

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
    this.sessionManager.setRunning(session.threadKey, true);

    try {
      const options: Record<string, unknown> = {
        abortController: session.abortController,
        cwd: session.cwd,
        allowedTools: [],
        maxTurns: 50,
      };

      if (session.conversationId) {
        (options as any).resume = true;
        (options as any).conversationId = session.conversationId;
      }

      if (session.mode === 'auto') {
        (options as any).permissionMode = 'bypassPermissions';
      } else {
        (options as any).permissionMode = 'default';
        (options as any).permissionPromptToolName = 'Claude Slack Bot';
      }

      const result = await query({
        prompt,
        options: options as any,
      });

      // Process the result messages
      let resultText = '';
      if (Array.isArray(result)) {
        for (const message of result) {
          this.processMessage(message as MessageEvent, session, callbacks);
          // Extract final text
          if ((message as any).type === 'result') {
            resultText = (message as any).result || '';
          }
        }
      }

      // If result is the final text directly
      if (typeof result === 'string') {
        resultText = result;
      }

      // Extract conversationId from result messages for session resume
      if (Array.isArray(result)) {
        for (const msg of result) {
          if ((msg as any).type === 'system' && (msg as any).subtype === 'init') {
            const convId = (msg as any).conversationId || (msg as any).session_id;
            if (convId) {
              this.sessionManager.updateConversationId(session.threadKey, convId);
            }
          }
        }
      }

      if (!resultText && Array.isArray(result)) {
        // Try to extract text from assistant messages
        for (const msg of result) {
          if ((msg as any).role === 'assistant' && (msg as any).content) {
            const content = (msg as any).content;
            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              resultText = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n');
            }
          }
        }
      }

      callbacks.onComplete(resultText);
    } catch (err: any) {
      if (err.name === 'AbortError' || session.abortController.signal.aborted) {
        callbacks.onError(new Error('Query was stopped'));
      } else {
        callbacks.onError(err);
      }
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
