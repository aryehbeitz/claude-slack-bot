import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSession, Config } from '../types';
import { PermissionHandler } from './permission-handler';
import { SessionManager } from './session-manager';
import { classifyError } from '../utils/errors';

export interface QueryCallbacks {
  onText: (text: string) => void | Promise<void>;
  onToolUse: (toolName: string, toolInput: Record<string, unknown>) => void | Promise<void>;
  onToolResult: (toolName: string, output: string) => void | Promise<void>;
  onComplete: (resultText: string) => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
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
    const isResuming = !!session.sessionId;
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
          this.logMessage(msg, isResuming);
        }

        // Extract session_id for session resume
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.sessionManager.updateSessionId(session.threadKey, msg.session_id);
        }

        // Extract final result — handle error results (SDK sends these instead of throwing)
        if (msg.type === 'result') {
          const isError =
            msg.is_error ||
            (typeof msg.subtype === 'string' && msg.subtype.startsWith('error_'));
          if (isError) {
            const errors = Array.isArray(msg.errors) ? msg.errors : [];
            const errorMsg =
              errors.length > 0
                ? errors.join('\n')
                : msg.subtype || 'Query failed';
            const error = new Error(`:x: ${errorMsg}`);
            (error as Error & { rawDetail?: string }).rawDetail = errorMsg;
            await callbacks.onError(error);
            return;
          }
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
              await callbacks.onToolUse(block.name, block.input || {});
            }
          }

          // Emit only the new text delta
          if (fullText.length > lastTextLength) {
            const delta = fullText.slice(lastTextLength);
            callbacks.onText(delta);
            lastTextLength = fullText.length;
          }
        }

        // Process tool results — prefer top-level tool_use_result.stdout
        if (msg.type === 'user') {
          const stdout = msg.tool_use_result?.stdout;
          if (typeof stdout === 'string' && stdout.length > 0) {
            await callbacks.onToolResult('tool', stdout);
          } else if (msg.message?.content) {
            const content = Array.isArray(msg.message.content) ? msg.message.content : [];
            for (const block of content) {
              if (block.type === 'tool_result') {
                let output: string;
                if (typeof block.content === 'string') {
                  output = block.content;
                } else if (Array.isArray(block.content)) {
                  output = block.content
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text || '')
                    .join('\n');
                } else {
                  output = JSON.stringify(block.content);
                }
                if (output) {
                  await callbacks.onToolResult('tool', output);
                }
              }
            }
          }
        }
      }

      await callbacks.onComplete(resultText);
    } catch (err: unknown) {
      const classified = classifyError(err);
      console[classified.logLevel](
        `[query-runner] ${classified.emoji} ${classified.userMessage}`,
        err instanceof Error ? err.message : String(err)
      );
      const error = new Error(`${classified.emoji} ${classified.userMessage}`);
      if (classified.rawDetail) {
        (error as Error & { rawDetail?: string }).rawDetail = classified.rawDetail;
      }
      await callbacks.onError(error);
    } finally {
      this.sessionManager.setRunning(session.threadKey, false);
    }
  }

  /** Pretty-print SDK messages like Claude's live thinking */
  private logMessage(msg: { type?: string; subtype?: string; session_id?: string; cwd?: string; message?: { content?: Array<{ type?: string; thinking?: string; text?: string; name?: string; input?: Record<string, unknown> }> }; tool_use_result?: { stdout?: string }; duration_ms?: number; total_cost_usd?: number; num_turns?: string }, isResuming: boolean) {
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const cyan = '\x1b[36m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const magenta = '\x1b[35m';

    if (msg.type === 'system' && msg.subtype === 'init') {
      const label = isResuming ? 'Session continued' : 'Session started';
      console.log(`${cyan}● ${label}${reset} ${dim}${msg.session_id}${reset}`);
      console.log(`  ${dim}cwd: ${msg.cwd}${reset}`);
    } else if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'thinking') {
          console.log(`${dim}💭 ${block.thinking?.slice(0, 200)}${reset}`);
        } else if (block.type === 'text') {
          console.log(`${bold}${green}◆ Claude:${reset} ${block.text?.slice(0, 300)}`);
        } else if (block.type === 'tool_use') {
          const input = block.input || {};
          const detail = input.command || input.file_path || input.pattern || input.description || '';
          console.log(`${yellow}⚡ ${block.name}${reset} ${dim}${detail}${reset}`);
        }
      }
    } else if (msg.type === 'user') {
      const stdout = msg.tool_use_result?.stdout;
      if (stdout) {
        const lines = stdout.split('\n');
        const preview = lines.slice(0, 3).join('\n');
        const more = lines.length > 3 ? `${dim} (${lines.length - 3} more lines)${reset}` : '';
        console.log(`${magenta}  ↳${reset} ${dim}${preview}${reset}${more}`);
      }
    } else if (msg.type === 'result') {
      const dur = msg.duration_ms ? `${(msg.duration_ms / 1000).toFixed(1)}s` : '';
      const cost = msg.total_cost_usd ? `$${msg.total_cost_usd.toFixed(4)}` : '';
      const turns = msg.num_turns || '';
      console.log(`${green}✓ Done${reset} ${dim}${turns} turns · ${dur} · ${cost}${reset}`);
    } else if (msg.type === 'rate_limit_event') {
      // skip noise
    } else {
      console.log(`${dim}[${msg.type}${msg.subtype ? '.' + msg.subtype : ''}]${reset}`);
    }
  }
}
