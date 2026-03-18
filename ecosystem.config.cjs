module.exports = {
  apps: [
    {
      name: 'claude-slack-bot',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      watch: ['src'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'dist', '.bot-state.json'],
      env: {
        NODE_ENV: 'development',
      },
      // Restart on file changes
      autorestart: true,
      // Max restarts before stopping
      max_restarts: 10,
      // Wait before restarting
      restart_delay: 1000,
      // Logs
      log_date_format: 'HH:mm:ss',
      merge_logs: true,
    },
  ],
};
