import winston from "winston";
import path from "path";
import fs from "fs";

const LOGS_DIR = path.resolve(__dirname, "..", "..", "output", "logs");

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const customFormat = winston.format.printf(
    ({ level, message, timestamp, context, ...metadata }) => {
        const ctx = context ? `[${context}]` : "";
        const meta =
            Object.keys(metadata).length > 0
                ? ` ${JSON.stringify(metadata)}`
                : "";
        return `${timestamp} ${level.toUpperCase().padEnd(7)} ${ctx} ${message}${meta}`;
    }
);

const logger = winston.createLogger({
    level: "debug",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.errors({ stack: true }),
        customFormat
    ),
    transports: [
        // Console — colorized
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({ all: true }),
                winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
                customFormat
            ),
        }),
        // File — combined log
        new winston.transports.File({
            filename: path.join(LOGS_DIR, "automation.log"),
            maxsize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
        }),
        // File — errors only
        new winston.transports.File({
            filename: path.join(LOGS_DIR, "errors.log"),
            level: "error",
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
        }),
    ],
});

/**
 * Create a child logger with a context label.
 * Usage: `const log = createLogger("RocketPage");`
 */
export function createLogger(context: string): winston.Logger {
    return logger.child({ context });
}

export default logger;
