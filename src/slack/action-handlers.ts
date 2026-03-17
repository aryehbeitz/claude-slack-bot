import { App } from '@slack/bolt';
import { PermissionHandler } from '../claude/permission-handler';

export function registerActionHandlers(
  app: App,
  permissionHandler: PermissionHandler
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
}
