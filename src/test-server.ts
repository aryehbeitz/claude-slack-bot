import * as http from 'http';
import { QueryRunner } from './claude/query-runner';
import { SessionManager } from './claude/session-manager';
import { ClaudeSession } from './types';

const TEST_PORT = parseInt(process.env.TEST_PORT || '4041', 10);
const TEST_THREAD_KEY = '__test__';

export function startTestServer(
  queryRunner: QueryRunner,
  sessionManager: SessionManager
): void {
  const server = http.createServer(async (req, res) => {
    if ((req.method === 'GET' || req.method === 'POST') && req.url === '/test') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');

      const session = sessionManager.getOrCreate('__test__', '0');
      if (!sessionManager.claimRunning(session.threadKey)) {
        console.log('[test] Skipped — another query is running.');
        return;
      }

      const prompt = 'Run `date` in the shell and reply with the output (current date and time).';
      console.log(`[test] Running: ${prompt}`);

      try {
        let resultText = '';
        await queryRunner.run(session, prompt, {
          onText(chunk) {
            resultText += chunk;
          },
          async onToolUse() {},
          async onToolResult() {},
          async onComplete(text) {
            const out = (text || resultText).trim();
            if (out && !process.env.DEBUG) {
              console.log(`[test] Result: ${out}`);
            }
          },
          async onError(err) {
            console.error('[test] Error:', err.message);
          },
        });
      } finally {
        sessionManager.setRunning(session.threadKey, false);
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(TEST_PORT, '127.0.0.1', () => {
    console.log(`[test] Server listening on http://127.0.0.1:${TEST_PORT}/test`);
  });
}
