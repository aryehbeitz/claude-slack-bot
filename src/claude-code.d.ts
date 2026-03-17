declare module '@anthropic-ai/claude-code' {
  export interface QueryOptions {
    prompt: string;
    options?: {
      abortController?: AbortController;
      cwd?: string;
      allowedTools?: string[];
      maxTurns?: number;
      permissionMode?: 'default' | 'bypassPermissions';
      permissionPromptToolName?: string;
      resume?: boolean;
      conversationId?: string;
      sessionId?: string;
      [key: string]: unknown;
    };
  }

  export interface MessageEvent {
    type: string;
    subtype?: string;
    role?: string;
    content?: unknown;
    result?: string;
    conversationId?: string;
    session_id?: string;
    [key: string]: unknown;
  }

  export function query(options: QueryOptions): Promise<MessageEvent[]>;
}
