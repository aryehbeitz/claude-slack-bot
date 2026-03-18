import 'dotenv/config';
import { Config } from './types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalList(name: string): string[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
  return {
    slackBotToken: requireEnv('SLACK_BOT_TOKEN'),
    slackAppToken: requireEnv('SLACK_APP_TOKEN'),
    slackSigningSecret: requireEnv('SLACK_SIGNING_SECRET'),
    defaultCwd: process.env.DEFAULT_CWD || process.cwd(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    allowedUserIds: optionalList('ALLOWED_USER_IDS'),
    allowedChannelIds: optionalList('ALLOWED_CHANNEL_IDS'),
    sessionTimeoutMs:
      (parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30', 10) || 30) *
      60 *
      1000,
    messageUpdateIntervalMs:
      parseInt(process.env.MESSAGE_UPDATE_INTERVAL_MS || '1500', 10) || 1500,

    // Display flags
    showToolCalls: process.env.SHOW_TOOL_CALLS === '1',
    showToolResults: process.env.SHOW_TOOL_RESULTS === '1',
    showStreaming: process.env.SHOW_STREAMING !== '0', // default on
    showToolSummary: process.env.SHOW_TOOL_SUMMARY !== '0', // default on
  };
}
