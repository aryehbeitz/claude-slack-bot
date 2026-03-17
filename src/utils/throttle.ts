export function createThrottle(intervalMs: number) {
  const lastCall = new Map<string, number>();

  return function shouldExecute(key: string): boolean {
    const now = Date.now();
    const last = lastCall.get(key) || 0;
    if (now - last >= intervalMs) {
      lastCall.set(key, now);
      return true;
    }
    return false;
  };
}

export function createDebouncedUpdater<T>(
  intervalMs: number,
  executor: (key: string, value: T) => Promise<void>
) {
  const pending = new Map<string, { value: T; timer: NodeJS.Timeout }>();

  return {
    schedule(key: string, value: T) {
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(async () => {
        pending.delete(key);
        try {
          await executor(key, value);
        } catch (err) {
          console.error(`[throttle] Error executing for ${key}:`, err);
        }
      }, intervalMs);
      pending.set(key, { value, timer });
    },

    async flush(key: string) {
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        pending.delete(key);
        await executor(key, existing.value);
      }
    },

    cancel(key: string) {
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        pending.delete(key);
      }
    },
  };
}
