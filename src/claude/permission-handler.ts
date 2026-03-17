import { WebClient } from '@slack/web-api';
import { PendingPermission } from '../types';

export class PermissionHandler {
  private pending = new Map<string, PendingPermission>();

  constructor(private slackClient: WebClient) {}

  async requestPermission(
    channelId: string,
    threadTs: string,
    threadKey: string,
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const inputPreview = formatToolInput(toolName, toolInput);

    const result = await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Permission requested: ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:lock: *Permission Request*\n*Tool:* \`${toolName}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`\n${inputPreview}\n\`\`\``,
          },
        },
        {
          type: 'actions',
          block_id: `perm_actions_${id}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `perm_approve_${id}`,
              value: id,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Deny' },
              style: 'danger',
              action_id: `perm_deny_${id}`,
              value: id,
            },
          ],
        },
      ],
    });

    return new Promise<boolean>((resolve) => {
      this.pending.set(id, {
        id,
        threadKey,
        toolName,
        toolInput,
        resolve,
        messageTs: result.ts,
      });

      // Auto-deny after 5 minutes
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(false);
          this.updatePermissionMessage(channelId, result.ts!, false, '(timed out)');
        }
      }, 5 * 60 * 1000);
    });
  }

  handleAction(permId: string, approved: boolean, userId: string): boolean {
    const pending = this.pending.get(permId);
    if (!pending) return false;

    this.pending.delete(permId);
    pending.resolve(approved);

    if (pending.messageTs) {
      const statusText = approved ? 'Approved' : 'Denied';
      this.updatePermissionMessage(
        '', // will need channelId passed through
        pending.messageTs,
        approved,
        `by <@${userId}>`
      ).catch(() => {});
    }

    return true;
  }

  resolveAction(
    permId: string,
    approved: boolean,
    channelId: string,
    userId: string
  ): boolean {
    const pending = this.pending.get(permId);
    if (!pending) return false;

    this.pending.delete(permId);
    pending.resolve(approved);

    if (pending.messageTs) {
      this.updatePermissionMessage(
        channelId,
        pending.messageTs,
        approved,
        `by <@${userId}>`
      ).catch(console.error);
    }

    return true;
  }

  private async updatePermissionMessage(
    channelId: string,
    messageTs: string,
    approved: boolean,
    detail: string
  ) {
    if (!channelId) return;
    const emoji = approved ? ':white_check_mark:' : ':x:';
    const status = approved ? 'Approved' : 'Denied';
    try {
      await this.slackClient.chat.update({
        channel: channelId,
        ts: messageTs,
        text: `${status} ${detail}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${status}* ${detail}`,
            },
          },
        ],
      });
    } catch (err) {
      console.error('[permission] Failed to update message:', err);
    }
  }

  hasPending(threadKey: string): boolean {
    for (const p of this.pending.values()) {
      if (p.threadKey === threadKey) return true;
    }
    return false;
  }
}

function formatToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  const maxLen = 1500;
  let text: string;

  if (toolName === 'Bash' || toolName === 'bash') {
    text = `$ ${input.command || ''}`;
  } else if (toolName === 'Write' || toolName === 'write') {
    const path = input.file_path || input.path || '';
    const content = String(input.content || '');
    const preview = content.length > 500 ? content.slice(0, 500) + '\n...' : content;
    text = `Write to: ${path}\n${preview}`;
  } else if (toolName === 'Edit' || toolName === 'edit') {
    const path = input.file_path || input.path || '';
    text = `Edit: ${path}\n- ${input.old_string ? `Replace: ${String(input.old_string).slice(0, 200)}` : ''}\n+ ${input.new_string ? String(input.new_string).slice(0, 200) : ''}`;
  } else {
    text = JSON.stringify(input, null, 2);
  }

  return text.length > maxLen ? text.slice(0, maxLen) + '\n...' : text;
}
