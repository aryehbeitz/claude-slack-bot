import { WebClient } from '@slack/web-api';
import { MessageBuffer } from '../types';
import { chunkText, markdownToMrkdwn } from './formatter';

const MAX_MSG_LEN = 39000;
const MAX_BLOCK_TEXT = 3000; // Slack section block text limit

export class MessageQueue {
  private buffers = new Map<string, MessageBuffer>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private slackClient: WebClient,
    private updateIntervalMs: number
  ) {}

  /** Start a new streaming message in a thread, with a Stop control button */
  async startMessage(
    threadKey: string,
    channelId: string,
    threadTs: string
  ): Promise<void> {
    // Post the streaming content message
    const result = await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: ':hourglass_flowing_sand: Thinking...',
    });

    // Post a separate control message with Stop button
    const controlResult = await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Running... tap Stop to interrupt',
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: ':large_blue_circle: *Running* — tap Stop to interrupt, or react with :octagonal_sign: on any message',
            },
          ],
        },
        {
          type: 'actions',
          block_id: `stop_actions_${threadKey}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Stop' },
              style: 'danger',
              action_id: `stop_query_${threadKey}`,
              value: threadKey,
            },
          ],
        },
      ],
    });

    this.buffers.set(threadKey, {
      threadKey,
      channelId,
      threadTs,
      messageTs: result.ts,
      controlMessageTs: controlResult.ts,
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

  /** Replace buffer content entirely (used for final result text) */
  setContent(threadKey: string, text: string) {
    const buffer = this.buffers.get(threadKey);
    if (!buffer) return;
    buffer.content = text;
    buffer.charCount = buffer.content.length;
    buffer.dirty = true;
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

    await this.removeControlMessage(buffer);

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

    await this.removeControlMessage(buffer);

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

  /** Delete the Stop button control message (cleanup after run finishes) */
  private async removeControlMessage(buffer: MessageBuffer): Promise<void> {
    if (!buffer.controlMessageTs) return;
    try {
      await this.slackClient.chat.delete({
        channel: buffer.channelId,
        ts: buffer.controlMessageTs,
      });
    } catch {
      // If delete fails (permissions), update it to show completed
      try {
        await this.slackClient.chat.update({
          channel: buffer.channelId,
          ts: buffer.controlMessageTs,
          text: 'Completed',
          blocks: [
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: ':white_check_mark: *Completed*' },
              ],
            },
          ],
        });
      } catch {}
    }
  }

  /** Build mrkdwn section blocks from text, splitting at block size limit */
  private textToBlocks(text: string): any[] {
    const chunks = chunkText(text, MAX_BLOCK_TEXT);
    return chunks.map((chunk) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    }));
  }

  private async flushBuffer(threadKey: string): Promise<void> {
    this.timers.delete(threadKey);
    const buffer = this.buffers.get(threadKey);
    if (!buffer || !buffer.dirty || !buffer.messageTs) return;

    buffer.dirty = false;
    const mrkdwn = markdownToMrkdwn(buffer.content) || '_Processing..._';

    // Build blocks for rich formatting
    const blocks = this.textToBlocks(mrkdwn);

    // Slack allows max 50 blocks per message
    if (blocks.length <= 50 && mrkdwn.length <= MAX_MSG_LEN) {
      try {
        await this.slackClient.chat.update({
          channel: buffer.channelId,
          ts: buffer.messageTs,
          text: mrkdwn, // fallback
          blocks,
        });
      } catch (err: any) {
        if (err?.data?.error === 'ratelimited' || err?.code === 429) {
          const retryAfter = (err?.data?.response_metadata?.retry_after || 3) * 1000;
          console.warn(`[message-queue] Slack rate limited, retrying in ${retryAfter}ms`);
          buffer.dirty = true;
          if (!this.timers.has(threadKey)) {
            const timer = setTimeout(
              () => this.flushBuffer(threadKey),
              retryAfter
            );
            this.timers.set(threadKey, timer);
          }
        } else {
          // Fall back to plain text if blocks fail
          try {
            await this.slackClient.chat.update({
              channel: buffer.channelId,
              ts: buffer.messageTs,
              text: mrkdwn,
            });
          } catch {
            console.error('[message-queue] Failed to update message:', err);
          }
        }
      }
    } else {
      // Too large for one message — update current, post overflow as new messages
      const firstBlocks = blocks.slice(0, 50);
      try {
        await this.slackClient.chat.update({
          channel: buffer.channelId,
          ts: buffer.messageTs,
          text: mrkdwn.slice(0, MAX_MSG_LEN),
          blocks: firstBlocks,
        });
      } catch (err) {
        console.error('[message-queue] Failed to update message:', err);
      }

      // Post remaining blocks as new messages
      for (let i = 50; i < blocks.length; i += 50) {
        const chunk = blocks.slice(i, i + 50);
        const chunkText = chunk.map((b: any) => b.text?.text || '').join('\n');
        try {
          const result = await this.slackClient.chat.postMessage({
            channel: buffer.channelId,
            thread_ts: buffer.threadTs,
            text: chunkText,
            blocks: chunk,
          });
          buffer.messageTs = result.ts;
        } catch (err) {
          console.error('[message-queue] Failed to post overflow:', err);
        }
      }
      // Track only latest content
      const lastChunk = blocks.slice(-50);
      buffer.content = lastChunk.map((b: any) => b.text?.text || '').join('\n');
      buffer.charCount = buffer.content.length;
    }
  }
}
