import { Page, Locator } from "playwright";
import { config, AppDefinition } from "../config/config";
import { createLogger } from "../utils/logger";
import { retryAsync, sleep } from "../utils/retry";

const log = createLogger("RocketPage");

/**
 * Page Object Model for Rocket.new platform.
 * Encapsulates all locators and interactions for app creation and publishing.
 *
 * Login is handled via saved Google OAuth session (storageState),
 * loaded by BrowserManager when creating the context.
 */
export class RocketPage {
    readonly page: Page;
    private readonly baseUrl: string;

    // ─── Locators ───────────────────────────────────────────────────────    // App creation
    private get promptInput(): Locator {
        return this.page.locator(
            'textarea[placeholder*="describe" i], textarea[placeholder*="build" i], ' +
            'textarea[placeholder*="create" i], textarea[placeholder*="app" i], ' +
            'div[contenteditable="true"], textarea:visible'
        );
    }
    private get generateButton(): Locator {
        return this.page.locator(
            'button:has-text("Generate"), button:has-text("Create"), ' +
            'button:has-text("Build"), button[type="submit"]:visible'
        );
    }

    // Generation status
    private get generationSpinner(): Locator {
        return this.page.locator(
            '[class*="spinner"], [class*="loading"], [class*="progress"], ' +
            '[role="progressbar"], [class*="generating"]'
        );
    }

    // Publish
    private get publishButton(): Locator {
        return this.page.locator(
            'button:has-text("Publish"), button:has-text("Deploy"), ' +
            'button:has-text("Share"), a:has-text("Publish")'
        );
    }
    private get publishedUrlElement(): Locator {
        return this.page.locator(
            'input[readonly][value*="http"], a[href*="rocket"][target="_blank"], ' +
            '[class*="url"] input, [class*="link"] input, ' +
            'input[value*=".vercel.app"], input[value*=".netlify.app"], ' +
            'a[href*="vercel"], a[href*="netlify"]'
        );
    }

    constructor(page: Page) {
        this.page = page;
        this.baseUrl = config.baseUrl;
    }

    /**
     * Navigate to the Rocket.new homepage.
     */
    async navigate(): Promise<void> {
        log.info(`Navigating to ${this.baseUrl}`);
        await this.page.goto(this.baseUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
        });
        await this.page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {
            log.warn("Network idle timeout — proceeding anyway");
        });
        log.info("Navigation complete");
    }

    /**
     * Verify login state using saved Google OAuth session.
     *
     * Since Rocket.new uses Google OAuth, direct email/password automation is not possible.
     * Instead, the browser context is pre-loaded with saved auth state (cookies/localStorage)
     * from a previous manual Google login.
     *
     * This method verifies that the saved session is still valid.
     * If not, it throws an error instructing the user to re-run the auth save script.
     */
    async login(): Promise<void> {
        log.info("Verifying Google OAuth login state...");

        await retryAsync(
            async () => {
                // Check if already logged in by looking for authenticated UI elements
                const isLoggedIn = await this.page.locator(
                    '[class*="avatar"], [class*="user"], [class*="profile"], ' +
                    'button:has-text("New"), button:has-text("Create"), ' +
                    'img[alt*="avatar" i], img[alt*="profile" i], ' +
                    '[data-testid*="user"], [aria-label*="account" i]'
                ).first().isVisible({ timeout: 15_000 }).catch(() => false);

                if (isLoggedIn) {
                    log.info("✓ Already logged in via saved Google session");
                    return;
                }

                // If not logged in, check if there's a Sign In button (session expired)
                const signInButton = this.page.locator(
                    'a:has-text("Sign in"), a:has-text("Login"), ' +
                    'button:has-text("Sign in"), button:has-text("Login"), ' +
                    'button:has-text("Get Started"), a:has-text("Get Started")'
                );

                if (await signInButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
                    log.error(
                        "Auth session expired or missing. " +
                        "Please re-run: npx ts-node src/scripts/saveAuthState.ts"
                    );
                    throw new Error(
                        "Google OAuth session expired. " +
                        "Run 'npx ts-node src/scripts/saveAuthState.ts' to login again and save your session."
                    );
                }

                // Final fallback: wait a bit more and check again
                await sleep(5000);
                const retryCheck = await this.page.locator(
                    '[class*="avatar"], button:has-text("New"), button:has-text("Create")'
                ).first().isVisible({ timeout: 10_000 }).catch(() => false);

                if (retryCheck) {
                    log.info("✓ Logged in (detected on retry)");
                    return;
                }

                throw new Error(
                    "Could not verify login state. " +
                    "Run 'npx ts-node src/scripts/saveAuthState.ts' to save your Google login session."
                );
            },
            {
                maxRetries: 2,
                delayMs: 3000,
                label: "Verify Google Auth",
            }
        );
    }

    /**
     * Create a new application using the provided definition.
     * Builds a detailed prompt from the app definition and submits it.
     */
    async createApp(definition: AppDefinition): Promise<void> {
        log.info(`Creating app: "${definition.appName}"`);

        const prompt = this.buildAppPrompt(definition);

        await retryAsync(
            async () => {
                // Click "New" or "Create" if not already on creation page
                const newButton = this.page.locator(
                    'button:has-text("New"), a:has-text("New Project"), a:has-text("Create")'
                );
                if (await newButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
                    await newButton.first().click();
                    await this.page.waitForLoadState("domcontentloaded");
                }

                // Enter the prompt
                const promptField = this.promptInput.first();
                await promptField.waitFor({ state: "visible", timeout: 15_000 });
                await promptField.click();
                await promptField.fill(prompt);
                log.debug(`Prompt entered for "${definition.appName}" (${prompt.length} chars)`);

                // Submit / Generate
                await this.generateButton.first().waitFor({ state: "visible", timeout: 10_000 });
                await this.generateButton.first().click();
                log.info(`Generation started for "${definition.appName}"`);
            },
            {
                maxRetries: 2,
                delayMs: 3000,
                label: `Create App: ${definition.appName}`,
            }
        );
    }

    /**
     * Wait for the application generation to complete.
     * Uses smart polling instead of static waits.
     */
    async waitForGeneration(timeoutMs: number = 300_000): Promise<void> {
        log.info("Waiting for app generation to complete...");
        const startTime = Date.now();

        await retryAsync(
            async () => {
                // Strategy 1: Wait for spinner/loading to disappear
                try {
                    await this.generationSpinner.first().waitFor({
                        state: "visible",
                        timeout: 10_000,
                    });
                    log.debug("Generation spinner detected — waiting for completion");

                    await this.generationSpinner.first().waitFor({
                        state: "hidden",
                        timeout: timeoutMs,
                    });
                    log.info("Generation spinner disappeared");
                } catch {
                    log.debug("No spinner detected — using fallback strategy");
                }

                // Strategy 2: Wait for publish/deploy button to appear (signals completion)
                await this.page.waitForFunction(
                    () => {
                        const buttons = document.querySelectorAll("button, a");
                        return Array.from(buttons).some((btn) => {
                            const text = btn.textContent?.toLowerCase() || "";
                            return (
                                text.includes("publish") ||
                                text.includes("deploy") ||
                                text.includes("share") ||
                                text.includes("preview")
                            );
                        });
                    },
                    { timeout: timeoutMs - (Date.now() - startTime) }
                );

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                log.info(`App generation completed in ${elapsed}s`);
            },
            {
                maxRetries: 1,
                delayMs: 5000,
                label: "Wait for Generation",
            }
        );
    }

    /**
     * Publish the generated application.
     */
    async publishApp(): Promise<void> {
        log.info("Publishing application...");

        await retryAsync(
            async () => {
                await this.publishButton.first().waitFor({
                    state: "visible",
                    timeout: 30_000,
                });
                await this.publishButton.first().click();
                log.debug("Publish button clicked");

                // Wait for publishing to complete
                await sleep(3000);

                // Confirm publish if there's a confirmation dialog
                const confirmButton = this.page.locator(
                    'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("OK")'
                );
                if (await confirmButton.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
                    await confirmButton.first().click();
                    log.debug("Publish confirmed");
                }

                log.info("Application published");
            },
            {
                maxRetries: 2,
                delayMs: 3000,
                label: "Publish App",
            }
        );
    }

    /**
     * Extract the published URL after publishing.
     */
    async getPublishedUrl(): Promise<string> {
        log.info("Extracting published URL...");

        return await retryAsync(
            async () => {
                // Wait for URL to appear
                await sleep(3000);

                // Strategy 1: Look for input fields with URL values
                const urlInput = this.publishedUrlElement.first();
                if (await urlInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
                    const tagName = await urlInput.evaluate((el) => el.tagName.toLowerCase());

                    if (tagName === "input") {
                        const url = await urlInput.inputValue();
                        if (url && url.startsWith("http")) {
                            log.info(`Published URL found (input): ${url}`);
                            return url;
                        }
                    } else if (tagName === "a") {
                        const url = await urlInput.getAttribute("href");
                        if (url && url.startsWith("http")) {
                            log.info(`Published URL found (link): ${url}`);
                            return url;
                        }
                    }
                }

                // Strategy 2: Search all visible text for URLs
                const pageContent = await this.page.content();
                const urlMatch = pageContent.match(
                    /https?:\/\/[^\s"'<>]+(?:\.vercel\.app|\.netlify\.app|\.rocket\.new)[^\s"'<>]*/
                );
                if (urlMatch) {
                    log.info(`Published URL found (regex): ${urlMatch[0]}`);
                    return urlMatch[0];
                }

                // Strategy 3: Check clipboard
                try {
                    const copyButton = this.page.locator(
                        'button:has-text("Copy"), button[aria-label*="copy" i]'
                    );
                    if (await copyButton.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
                        await copyButton.first().click();
                        const clipboardUrl = await this.page.evaluate(() =>
                            navigator.clipboard.readText()
                        );
                        if (clipboardUrl && clipboardUrl.startsWith("http")) {
                            log.info(`Published URL found (clipboard): ${clipboardUrl}`);
                            return clipboardUrl;
                        }
                    }
                } catch {
                    log.debug("Clipboard read failed");
                }

                // Strategy 4: Get from current page URL
                const currentUrl = this.page.url();
                if (currentUrl && !currentUrl.includes("rocket.new")) {
                    log.info(`Published URL (current page): ${currentUrl}`);
                    return currentUrl;
                }

                throw new Error("Could not extract published URL");
            },
            {
                maxRetries: 3,
                delayMs: 5000,
                label: "Extract Published URL",
            }
        );
    }

    /**
     * Take a screenshot and save to the screenshots directory.
     */
    async takeScreenshot(name: string): Promise<string> {
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const screenshotPath = `${config.screenshotsDir}/${sanitized}_${Date.now()}.png`;
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        log.debug(`Screenshot saved: ${screenshotPath}`);
        return screenshotPath;
    }

    /**
     * Build a detailed prompt from the app definition for Rocket.new.
     */
    private buildAppPrompt(definition: AppDefinition): string {
        return [
            `Build a ${definition.appName}`,
            ``,
            `Overview: ${definition.overview}`,
            ``,
            `Modules: ${definition.modules.join(", ")}`,
            ``,
            `Pages: ${definition.pages.join(", ")}`,
            ``,
            `Features: ${definition.features.join(", ")}`,
            ``,
            `Requirements: ${definition.functionalRequirements.join("; ")}`,
        ].join("\n");
    }
}
