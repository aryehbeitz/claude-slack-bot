import { ClaudeSession, Config } from '../types';

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private config: Config) {
    this.cleanupTimer = setInterval(
      () => this.cleanupIdleSessions(),
      60 * 1000
    );
  }

  makeKey(channelId: string, threadTs: string): string {
    return `${channelId}-${threadTs}`;
  }

  get(channelId: string, threadTs: string): ClaudeSession | undefined {
    const key = this.makeKey(channelId, threadTs);
    const session = this.sessions.get(key);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  getOrCreate(channelId: string, threadTs: string): ClaudeSession {
    const key = this.makeKey(channelId, threadTs);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        threadKey: key,
        channelId,
        threadTs,
        cwd: this.config.defaultCwd,
        mode: 'ask',
        isRunning: false,
        abortController: new AbortController(),
        lastActivity: Date.now(),
      };
      this.sessions.set(key, session);
      console.log(`[session] Created new session: ${key}`);
    } else {
      session.lastActivity = Date.now();
    }
    return session;
  }

  updateSessionId(threadKey: string, sessionId: string) {
    const session = this.sessions.get(threadKey);
    if (session) {
      session.sessionId = sessionId;
    }
  }

  updateConversationId(threadKey: string, conversationId: string) {
    const session = this.sessions.get(threadKey);
    if (session) {
      session.conversationId = conversationId;
    }
  }

  setMode(threadKey: string, mode: 'ask' | 'auto') {
    const session = this.sessions.get(threadKey);
    if (session) {
      session.mode = mode;
    }
  }

  setCwd(threadKey: string, cwd: string) {
    const session = this.sessions.get(threadKey);
    if (session) {
      session.cwd = cwd;
    }
  }

  /** Atomically claim the running slot. Returns false if already running. (#3, #4) */
  claimRunning(threadKey: string): boolean {
    const session = this.sessions.get(threadKey);
    if (!session || session.isRunning) return false;
    session.isRunning = true;
    session.abortController = new AbortController();
    return true;
  }

  setRunning(threadKey: string, running: boolean) {
    const session = this.sessions.get(threadKey);
    if (session) {
      if (running && session.isRunning) {
        // Abort orphaned controller before replacing (#4)
        session.abortController.abort();
      }
      session.isRunning = running;
      if (running) {
        session.abortController = new AbortController();
      }
    }
  }

  abort(threadKey: string): boolean {
    const session = this.sessions.get(threadKey);
    if (session?.isRunning) {
      session.abortController.abort();
      session.isRunning = false;
      return true;
    }
    return false;
  }

  listActive(): ClaudeSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.isRunning);
  }

  private cleanupIdleSessions() {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (!session.isRunning && now - session.lastActivity > this.config.sessionTimeoutMs) {
        this.sessions.delete(key);
        console.log(`[session] Cleaned up idle session: ${key}`);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      if (session.isRunning) {
        session.abortController.abort();
      }
    }
    this.sessions.clear();
  }
}
