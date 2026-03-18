import * as fs from 'fs';
import * as path from 'path';
import { ClaudeSession, Config } from '../types';

const STATE_FILE = path.join(process.cwd(), '.bot-state.json');

interface PersistedState {
  channelCwd: Record<string, string>;
  sessions: Record<string, { sessionId: string; cwd: string; channelId: string; threadTs: string }>;
}

export interface QueuedMessage {
  channelId: string;
  threadTs: string;
  text: string;
  files: any[] | undefined;
  client: any;
}

export class SessionManager {
  private sessions = new Map<string, ClaudeSession>();
  private channelCwd = new Map<string, string>();
  private messageQueue = new Map<string, QueuedMessage>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private config: Config) {
    this.loadState();
    this.cleanupTimer = setInterval(
      () => this.cleanupIdleSessions(),
      60 * 1000
    );
  }

  private loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data: PersistedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        if (data.channelCwd) {
          for (const [k, v] of Object.entries(data.channelCwd)) {
            this.channelCwd.set(k, v);
          }
          console.log(`[session] Loaded ${this.channelCwd.size} channel CWD(s) from state`);
        }
        if (data.sessions) {
          for (const [key, s] of Object.entries(data.sessions)) {
            this.sessions.set(key, {
              threadKey: key,
              sessionId: s.sessionId,
              channelId: s.channelId,
              threadTs: s.threadTs,
              cwd: s.cwd,
              mode: 'ask',
              isRunning: false,
              abortController: new AbortController(),
              lastActivity: Date.now(),
            });
          }
          console.log(`[session] Loaded ${Object.keys(data.sessions).length} session(s) from state`);
        }
      }
    } catch (err) {
      console.warn('[session] Failed to load state:', err);
    }
  }

  private saveState() {
    try {
      // Persist sessions that have a sessionId (for resume)
      const sessionsToSave: PersistedState['sessions'] = {};
      for (const [key, s] of this.sessions) {
        if (key.startsWith('__test__')) continue;
        if (s.sessionId) {
          sessionsToSave[key] = {
            sessionId: s.sessionId,
            cwd: s.cwd,
            channelId: s.channelId,
            threadTs: s.threadTs,
          };
        }
      }

      const data: PersistedState = {
        channelCwd: Object.fromEntries(this.channelCwd),
        sessions: sessionsToSave,
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('[session] Failed to save state:', err);
    }
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
        cwd: this.channelCwd.get(channelId) || this.config.defaultCwd,
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
      this.saveState();
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

  setChannelCwd(channelId: string, cwd: string) {
    this.channelCwd.set(channelId, cwd);
    this.saveState();
  }

  /** Queue a message to be processed after the current query finishes */
  queueMessage(threadKey: string, msg: QueuedMessage) {
    // Only keep the latest queued message per thread
    this.messageQueue.set(threadKey, msg);
  }

  /** Dequeue a pending message (returns undefined if none) */
  dequeueMessage(threadKey: string): QueuedMessage | undefined {
    const msg = this.messageQueue.get(threadKey);
    if (msg) {
      this.messageQueue.delete(threadKey);
    }
    return msg;
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
