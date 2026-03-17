import { App } from '@slack/bolt';
import { PermissionHandler } from '../claude/permission-handler';
import { SessionManager } from '../claude/session-manager';
import { MessageQueue } from './message-queue';

export function registerActionHandlers(
  app: App,
  permissionHandler: PermissionHandler,
  sessionManager: SessionManager,
  messageQueue: MessageQueue
) {
  // Handle all permission approve/deny button clicks
  app.action(/^perm_(approve|deny)_(.+)$/, async ({ action, ack, body }) => {
    await ack();

    const match = (action as any).action_id.match(
      /^perm_(approve|deny)_(.+)$/
    );
    if (!match) return;

    const approved = match[1] === 'approve';
    const permId = match[2];
    const userId = body.user.id;
    const channelId = (body as any).channel?.id || (body as any).container?.channel_id;

    const resolved = permissionHandler.resolveAction(
      permId,
      approved,
      channelId,
      userId
    );

    if (!resolved) {
      console.warn(`[action] Permission ${permId} not found or already resolved`);
    }
  });

  // Handle Stop button clicks on the control message
  app.action(/^stop_query_(.+)$/, async ({ action, ack, body }) => {
    await ack();

    const threadKey = (action as any).value;
    if (!threadKey) return;

    const aborted = sessionManager.abort(threadKey);
    const userId = body.user.id;

    if (aborted) {
      console.log(`[action] Query stopped by <@${userId}> via button for ${threadKey}`);
      await messageQueue.error(threadKey, `Stopped by <@${userId}>`);
    }
  });

  // Handle :octagonal_sign: (stop sign) emoji reaction to stop a running query
  app.event('reaction_added', async ({ event }) => {
    const reaction = event as any;
    if (reaction.reaction !== 'octagonal_sign') return;

    const channelId = reaction.item?.channel;
    if (!channelId) return;

    // Find any running session in this channel
    const activeSessions = sessionManager.listActive();
    const session = activeSessions.find((s) => s.channelId === channelId);

    if (session) {
      const aborted = sessionManager.abort(session.threadKey);
      if (aborted) {
        console.log(`[action] Query stopped by <@${reaction.user}> via :octagonal_sign: reaction`);
        await messageQueue.error(
          session.threadKey,
          `Stopped by <@${reaction.user}> via :octagonal_sign:`
        );
      }
    }
  });
}
