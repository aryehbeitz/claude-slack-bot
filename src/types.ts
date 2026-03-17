export interface ClaudeSession {
  threadKey: string;
  sessionId?: string;
  conversationId?: string;
  channelId: string;
  threadTs: string;
  cwd: string;
  mode: 'ask' | 'auto';
  isRunning: boolean;
  abortController: AbortController;
  lastActivity: number;
}

export interface PendingPermission {
  id: string;
  threadKey: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  messageTs?: string;
}

export interface MessageBuffer {
  threadKey: string;
  channelId: string;
  threadTs: string;
  messageTs?: string;
  controlMessageTs?: string; // "Running... [Stop]" message, deleted on complete
  content: string;
  dirty: boolean;
  charCount: number;
}

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  defaultCwd: string;
  anthropicApiKey: string;
  allowedUserIds: string[];
  allowedChannelIds: string[];
  sessionTimeoutMs: number;
  messageUpdateIntervalMs: number;
}
