/** Classify SDK/network errors into user-friendly messages */
export interface ClassifiedError {
  userMessage: string;
  emoji: string;
  retryable: boolean;
  logLevel: 'warn' | 'error';
  /** Raw error detail to show in Slack when userMessage is a summary */
  rawDetail?: string;
}

export function classifyError(err: any): ClassifiedError {
  const msg = err?.message || String(err);
  const status = err?.status || err?.statusCode || err?.response?.status;

  // Abort / user stop
  if (err?.name === 'AbortError' || msg.includes('abort')) {
    return {
      userMessage: 'Query was stopped.',
      emoji: ':stop_sign:',
      retryable: false,
      logLevel: 'warn',
    };
  }

  // Authentication / API key issues
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('api key') ||
    msg.includes('API key') ||
    msg.includes('not authenticated') ||
    msg.includes('invalid_api_key') ||
    msg.includes('Could not resolve authentication')
  ) {
    return {
      userMessage:
        'Claude authentication failed. Check that `ANTHROPIC_API_KEY` is set and valid, or run `claude login` on the host machine.',
      emoji: ':key:',
      retryable: false,
      logLevel: 'error',
      rawDetail: msg.slice(0, 1000),
    };
  }

  // Rate limiting
  if (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('Rate limit')
  ) {
    return {
      userMessage:
        'Rate limited by the Anthropic API. Please wait a moment and try again.',
      emoji: ':hourglass:',
      retryable: true,
      logLevel: 'warn',
    };
  }

  // Token/credit exhaustion
  if (
    status === 402 ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    msg.includes('credit') ||
    msg.includes('quota') ||
    msg.includes('exceeded') ||
    msg.includes('payment')
  ) {
    return {
      userMessage:
        'Anthropic API credits exhausted or billing issue. Check your account at console.anthropic.com.',
      emoji: ':credit_card:',
      retryable: false,
      logLevel: 'error',
    };
  }

  // Context length / token limit exceeded in a single request
  if (
    msg.includes('context length') ||
    msg.includes('too long') ||
    msg.includes('max_tokens') ||
    msg.includes('token limit')
  ) {
    return {
      userMessage:
        'The conversation is too long for Claude to process. Start a new thread to reset context.',
      emoji: ':scroll:',
      retryable: false,
      logLevel: 'warn',
    };
  }

  // Claude CLI not found
  if (
    msg.includes('ENOENT') ||
    msg.includes('not found') ||
    msg.includes('command not found') ||
    msg.includes('No such file')
  ) {
    return {
      userMessage:
        'Claude Code CLI not found on this machine. Install it: `npm install -g @anthropic-ai/claude-code`',
      emoji: ':wrench:',
      retryable: false,
      logLevel: 'error',
    };
  }

  // Network / connection errors
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('EAI_AGAIN') ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return {
      userMessage:
        'Network error — could not reach the Anthropic API. Check your internet connection. Will retry automatically if transient.',
      emoji: ':cloud:',
      retryable: true,
      logLevel: 'warn',
    };
  }

  // Anthropic API overloaded
  if (status === 529 || msg.includes('overloaded')) {
    return {
      userMessage:
        'The Anthropic API is currently overloaded. Please try again in a few minutes.',
      emoji: ':fire:',
      retryable: true,
      logLevel: 'warn',
    };
  }

  // Generic server error
  if (status >= 500) {
    return {
      userMessage: `Anthropic API server error (${status}). This is usually temporary — try again.`,
      emoji: ':warning:',
      retryable: true,
      logLevel: 'error',
      rawDetail: msg.slice(0, 1000),
    };
  }

  // Unknown — show summary + full error in rawDetail for debugging
  return {
    userMessage: 'Unexpected error (see details below)',
    emoji: ':x:',
    retryable: false,
    logLevel: 'error',
    rawDetail: msg,
  };
}

/** Retry a function with exponential backoff for transient errors */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelay = opts.baseDelayMs ?? 2000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (opts.signal?.aborted) throw err;

      const classified = classifyError(err);
      if (!classified.retryable || attempt >= maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed (${classified.userMessage}), retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
