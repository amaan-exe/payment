// ========================
// Database Retry Wrapper
// ========================
// Wraps any async database operation with exponential backoff
// to handle Neon cold starts and transient connection failures.

const winston = require('winston');

// Standalone logger for the retry module (avoids circular dependency with server.js)
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
            `${timestamp} [${level.toUpperCase()}] ${message}`
        )
    ),
    transports: [new winston.transports.Console()],
});

/**
 * Execute `fn` with automatic retries on failure.
 *
 * @param {Function} fn        — async function to execute (the DB operation)
 * @param {Object}   options
 * @param {number}   options.retries  — max retry attempts (default 3)
 * @param {string}   options.label    — human-readable label for logs
 * @returns {Promise<*>} — whatever `fn` resolves to
 */
async function withRetry(fn, { retries = 3, label = 'db operation' } = {}) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt === retries) {
                logger.error(
                    `[DB FAIL] "${label}" failed after ${retries} attempts: ${err.message}`
                );
                throw err;
            }

            // Exponential backoff: 2s, 4s, 8s …
            const delayMs = Math.pow(2, attempt) * 1000;
            logger.warn(
                `[DB RETRY] Attempt ${attempt}/${retries} for "${label}" failed — retrying in ${delayMs}ms… (${err.message})`
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    // Should never reach here, but just in case
    throw lastError;
}

module.exports = { withRetry };
