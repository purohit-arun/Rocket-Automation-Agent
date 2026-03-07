import { Browser, BrowserContext, chromium, LaunchOptions } from "playwright";
import { config } from "../config/config";
import { createLogger } from "../utils/logger";
import fs from "fs";

const log = createLogger("BrowserManager");

/**
 * Manages Playwright browser and context lifecycle.
 * Provides reusable browser context with screenshots directory and tracing support.
 */
export class BrowserManager {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private tracingStarted: boolean = false;

    /**
     * Launch a new browser instance.
     */
    async launch(options?: Partial<LaunchOptions>): Promise<Browser> {
        log.info("Launching browser", { headless: config.headless });

        // Ensure screenshots directory exists
        if (!fs.existsSync(config.screenshotsDir)) {
            fs.mkdirSync(config.screenshotsDir, { recursive: true });
        }

        this.browser = await chromium.launch({
            channel: "chrome",  // Use real installed Chrome (same as auth save script)
            headless: config.headless,
            slowMo: 100,
            args: [
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
            ],
            ignoreDefaultArgs: ["--enable-automation"],
            ...options,
        });

        log.info("Browser launched successfully");
        return this.browser;
    }

    /**
     * Create a new browser context with standard configuration.
     * If a saved auth state exists, it is loaded automatically (for Google OAuth sessions).
     */
    async newContext(useAuthState: boolean = true): Promise<BrowserContext> {
        if (!this.browser) {
            await this.launch();
        }

        const contextOptions: Record<string, unknown> = {
            viewport: null,
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            ignoreHTTPSErrors: true,
            recordVideo: {
                dir: config.screenshotsDir,
            },
        };

        // Load saved auth state if available (Google OAuth session)
        if (useAuthState && fs.existsSync(config.authStatePath)) {
            contextOptions.storageState = config.authStatePath;
            log.info(`Loaded saved auth state from: ${config.authStatePath}`);
        } else if (useAuthState) {
            log.warn(
                `Auth state file not found: ${config.authStatePath}. ` +
                `Run "npx ts-node src/scripts/saveAuthState.ts" to login and save your Google session.`
            );
        }

        this.context = await this.browser!.newContext(contextOptions);

        // Start tracing for debugging
        try {
            await this.context.tracing.start({
                screenshots: true,
                snapshots: true,
                sources: true,
            });
            this.tracingStarted = true;
            log.info("Browser context created with tracing enabled");
        } catch (error) {
            this.tracingStarted = false;
            log.warn("Tracing could not be started — continuing without tracing", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return this.context;
    }

    // detectScreenSize removed because viewport is set to null to utilize full window size natively

    /**
     * Save the current browser context's auth state to file.
     * Used after manual Google login to persist the session.
     */
    async saveAuthState(): Promise<void> {
        if (!this.context) {
            throw new Error("No browser context to save auth state from");
        }

        const dir = require("path").dirname(config.authStatePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        await this.context.storageState({ path: config.authStatePath });
        log.info(`Auth state saved to: ${config.authStatePath}`);
    }

    /**
     * Get the current browser context.
     */
    getContext(): BrowserContext | null {
        return this.context;
    }

    /**
     * Get the current browser instance.
     */
    getBrowser(): Browser | null {
        return this.browser;
    }

    /**
     * Close the browser context and save trace.
     */
    async closeContext(): Promise<void> {
        if (this.context) {
            // Only stop tracing if it was successfully started
            if (this.tracingStarted) {
                try {
                    const tracePath = `${config.outputDir}/trace-${Date.now()}.zip`;
                    await this.context.tracing.stop({ path: tracePath });
                    log.info(`Trace saved: ${tracePath}`);
                    this.tracingStarted = false;
                } catch (error) {
                    log.warn("Failed to save trace", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            try {
                await this.context.close();
                log.info("Browser context closed");
            } catch (error) {
                log.warn("Failed to close context cleanly", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            this.context = null;
        }
    }

    /**
     * Close everything — context and browser.
     */
    async close(): Promise<void> {
        await this.closeContext();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            log.info("Browser closed");
        }
    }
}
