/** Wrap an error in this to stop retrying at once and reject with the original. */
export class NonRetryableError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
  }
}

/**
 * Runs `attempt` until it succeeds, waiting `delaysMs[i]` after the i-th
 * failure — so `delaysMs.length + 1` attempts in all. `shouldContinue` is
 * checked before every attempt, including the first, so a caller can abandon
 * the work when it no longer matters. Rejects with the last error once the
 * delays are used up (or at once for a `NonRetryableError`); resolves `false` if `shouldContinue` stopped it.
 */
export async function retryWithDelays(
  attempt: (attemptNumber: number) => Promise<void>,
  delaysMs: readonly number[],
  options: {
    shouldContinue?: () => Promise<boolean>;
    onRetry?: (error: unknown, attemptNumber: number, delayMs: number) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attemptNumber = 1; ; attemptNumber++) {
    if (options.shouldContinue && !(await options.shouldContinue())) return false;
    try {
      await attempt(attemptNumber);
      return true;
    } catch (error) {
      if (error instanceof NonRetryableError) throw error.original;
      const delayMs = delaysMs[attemptNumber - 1];
      if (delayMs === undefined) throw error;
      options.onRetry?.(error, attemptNumber, delayMs);
      await sleep(delayMs);
    }
  }
}
