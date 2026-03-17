import { App, LogLevel } from '@slack/bolt';
import { Config } from '../types';

export function createSlackApp(config: Config): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    signingSecret: config.slackSigningSecret,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  return app;
}
