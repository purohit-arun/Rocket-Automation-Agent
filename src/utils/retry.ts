import { createLogger } from "./logger";

const log = createLogger("Retry");

export interface RetryOptions {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Initial delay between retries in ms (default: 2000) */
    delayMs?: number;
    /** Whether to apply exponential backoff (default: true) */
    exponentialBackoff?: boolean;
    /** Optional label for logging */
    label?: string;
    /** Custom condition to determine if error is retryable */
    retryCondition?: (error: unknown) => boolean;
}

/**
 * Generic retry wrapper for async operations.
 * Supports exponential backoff, custom retry conditions, and structured logging.
 *
 * @example
 * const result = await retryAsync(
 *   () => fetchDataFromAPI(),
 *   { maxRetries: 3, delayMs: 1000, label: "API Fetch" }
 * );
 */
export async function retryAsync<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        delayMs = 2000,
        exponentialBackoff = true,
        label = "Operation",
        retryCondition,
    } = options;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            log.debug(`${label} — attempt ${attempt}/${maxRetries + 1}`);
            const result = await fn();
            if (attempt > 1) {
                log.info(`${label} — succeeded on attempt ${attempt}`);
            }
            return result;
        } catch (error) {
            lastError = error;
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // Check if we should retry
            if (retryCondition && !retryCondition(error)) {
                log.error(
                    `${label} — non-retryable error on attempt ${attempt}: ${errorMessage}`
                );
                throw error;
            }

            if (attempt <= maxRetries) {
                const waitTime = exponentialBackoff
                    ? delayMs * Math.pow(2, attempt - 1)
                    : delayMs;
                log.warn(
                    `${label} — attempt ${attempt} failed: ${errorMessage}. Retrying in ${waitTime}ms...`
                );
                await sleep(waitTime);
            } else {
                log.error(
                    `${label} — all ${maxRetries + 1} attempts exhausted. Last error: ${errorMessage}`
                );
            }
        }
    }

    throw lastError;
}

/**
 * Sleep utility (non-static wait — only used inside retry).
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
