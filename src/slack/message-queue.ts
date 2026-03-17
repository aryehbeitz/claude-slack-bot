import { WebClient } from '@slack/web-api';
import { MessageBuffer } from '../types';
import { chunkText, markdownToMrkdwn } from './formatter';

const MAX_MSG_LEN = 39000;

export class MessageQueue {
  private buffers = new Map<string, MessageBuffer>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private slackClient: WebClient,
    private updateIntervalMs: number
  ) {}

  /** Start a new streaming message in a thread */
  async startMessage(
    threadKey: string,
    channelId: string,
    threadTs: string
  ): Promise<void> {
    const result = await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: ':hourglass_flowing_sand: Thinking...',
    });

    this.buffers.set(threadKey, {
      threadKey,
      channelId,
      threadTs,
      messageTs: result.ts,
      content: '',
      dirty: false,
      charCount: 0,
    });

    // Add hourglass reaction
    try {
      await this.slackClient.reactions.add({
        channel: channelId,
        timestamp: threadTs,
        name: 'hourglass_flowing_sand',
      });
    } catch {
      // Reaction may already exist
    }
  }

  /** Append text to the buffer */
  appendText(threadKey: string, text: string) {
    const buffer = this.buffers.get(threadKey);
    if (!buffer) return;

    buffer.content += text;
    buffer.charCount = buffer.content.length;
    buffer.dirty = true;

    // Schedule update if not already scheduled
    if (!this.timers.has(threadKey)) {
      const timer = setTimeout(
        () => this.flushBuffer(threadKey),
        this.updateIntervalMs
      );
      this.timers.set(threadKey, timer);
    }
  }

  /** Force flush the buffer to Slack */
  async flush(threadKey: string): Promise<void> {
    const timer = this.timers.get(threadKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(threadKey);
    }
    await this.flushBuffer(threadKey);
  }

  /** Post a new standalone message in the thread (for tool use, etc.) */
  async postInThread(
    threadKey: string,
    text: string
  ): Promise<string | undefined> {
    const buffer = this.buffers.get(threadKey);
    if (!buffer) return;

    const result = await this.slackClient.chat.postMessage({
      channel: buffer.channelId,
      thread_ts: buffer.threadTs,
      text: markdownToMrkdwn(text),
    });
    return result.ts;
  }

  /** Mark the stream as complete */
  async complete(threadKey: string): Promise<void> {
    await this.flush(threadKey);

    const buffer = this.buffers.get(threadKey);
    if (!buffer) return;

    // Swap reactions
    try {
      await this.slackClient.reactions.remove({
        channel: buffer.channelId,
        timestamp: buffer.threadTs,
        name: 'hourglass_flowing_sand',
      });
    } catch {}

    try {
      await this.slackClient.reactions.add({
        channel: buffer.channelId,
        timestamp: buffer.threadTs,
        name: 'white_check_mark',
      });
    } catch {}

    this.buffers.delete(threadKey);
  }

  /** Mark the stream as errored */
  async error(threadKey: string, errorText: string): Promise<void> {
    await this.flush(threadKey);

    const buffer = this.buffers.get(threadKey);
    if (!buffer) return;

    await this.slackClient.chat.postMessage({
      channel: buffer.channelId,
      thread_ts: buffer.threadTs,
      text: `:x: Error: ${errorText}`,
    });

    // Swap reactions
    try {
      await this.slackClient.reactions.remove({
        channel: buffer.channelId,
        timestamp: buffer.threadTs,
        name: 'hourglass_flowing_sand',
      });
    } catch {}

    try {
      await this.slackClient.reactions.add({
        channel: buffer.channelId,
        timestamp: buffer.threadTs,
        name: 'x',
      });
    } catch {}

    this.buffers.delete(threadKey);
  }

  private async flushBuffer(threadKey: string): Promise<void> {
    this.timers.delete(threadKey);
    const buffer = this.buffers.get(threadKey);
    if (!buffer || !buffer.dirty || !buffer.messageTs) return;

    buffer.dirty = false;
    const text = markdownToMrkdwn(buffer.content) || '_Processing..._';

    // If content exceeds limit, post new message and continue there
    if (text.length > MAX_MSG_LEN) {
      const chunks = chunkText(text, MAX_MSG_LEN);
      // Update current message with first chunk
      try {
        await this.slackClient.chat.update({
          channel: buffer.channelId,
          ts: buffer.messageTs,
          text: chunks[0],
        });
      } catch (err) {
        console.error('[message-queue] Failed to update message:', err);
      }

      // Post remaining chunks as new messages, use last as new buffer target
      for (let i = 1; i < chunks.length; i++) {
        try {
          const result = await this.slackClient.chat.postMessage({
            channel: buffer.channelId,
            thread_ts: buffer.threadTs,
            text: chunks[i],
          });
          if (i === chunks.length - 1) {
            buffer.messageTs = result.ts;
          }
        } catch (err) {
          console.error('[message-queue] Failed to post chunk:', err);
        }
      }
      // Reset content to just what's in the latest message
      buffer.content = chunks[chunks.length - 1];
      buffer.charCount = buffer.content.length;
    } else {
      try {
        await this.slackClient.chat.update({
          channel: buffer.channelId,
          ts: buffer.messageTs,
          text,
        });
      } catch (err) {
        console.error('[message-queue] Failed to update message:', err);
      }
    }
  }
}
