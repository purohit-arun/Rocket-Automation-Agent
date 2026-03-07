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

    constructor(page: Page) {
        this.page = page;
        this.baseUrl = config.baseUrl;
    }

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

    // Preview button — appears enabled when app generation is complete
    private get previewButton(): Locator {
        return this.page.locator(
            '[data-tooltip-id="tooltip-Preview"] button, ' +
            'button:has-text("Preview")'
        );
    }

    // Launch button — the publish/deploy action on Rocket.new
    private get launchButton(): Locator {
        return this.page.locator(
            'button:has-text("Launch")'
        );
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

                // Dismiss cookie banner if it appears
                const cookieAcceptBtn = this.page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
                if (await cookieAcceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await cookieAcceptBtn.click();
                    log.debug("Dismissed cookie consent banner ('Accept All')");
                    // Wait briefly for the banner to animate away
                    await sleep(1000);
                }

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

        // Wait for the intermediate "Build my..." button to appear after analysis
        // This is a required wizard step on Rocket.new before final generation.
        log.info("Waiting for initial analysis to complete and 'Build my...' button to appear...");
        try {
            const buildMyBtn = this.page.locator('button', { hasText: /build my/i }).first();
            await buildMyBtn.waitFor({ state: "visible", timeout: 120_000 });
            await sleep(2000); // Small pause to let the UI fully settle before clicking
            await buildMyBtn.click();
            log.info("Clicked 'Build my...' button to start actual generation");
        } catch {
            log.warn("Did not find 'Build my...' button within 2 minutes. Assuming generation started automatically.");
        }
    }

    /**
     * Wait for the application generation to complete.
     *
     * Detection strategy (based on real Rocket.new DOM):
     *  1. Wait for the "Preview" button to appear and become enabled (aria-disabled="false")
     *  2. Wait for the "Launch" button to appear and become enabled (aria-disabled="false")
     *  Both buttons only appear in enabled form AFTER generation completes.
     */
    async waitForGeneration(timeoutMs: number = 300_000): Promise<void> {
        log.info("Waiting for app generation to complete...");
        const startTime = Date.now();

        // Phase 1: Optionally wait for loading/spinner to appear then disappear
        try {
            const spinner = this.generationSpinner.first();
            await spinner.waitFor({ state: "visible", timeout: 15_000 });
            log.debug("Generation activity detected — waiting for it to finish...");
            await spinner.waitFor({ state: "hidden", timeout: timeoutMs });
            log.debug("Generation activity ended");
        } catch {
            log.debug("No spinner detected — checking for completion buttons directly");
        }

        // Phase 2: Wait for PREVIEW button to be visible and enabled
        log.info("Waiting for Preview button to become enabled...");
        await this.page.waitForFunction(
            () => {
                // Look for the Preview button using tooltip or text
                const tooltipBtn = document.querySelector('[data-tooltip-id="tooltip-Preview"] button');
                if (tooltipBtn) {
                    return tooltipBtn.getAttribute('aria-disabled') !== 'true';
                }
                // Fallback: find by text
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent?.trim().toLowerCase() === 'preview') {
                        return btn.getAttribute('aria-disabled') !== 'true';
                    }
                }
                return false;
            },
            { timeout: timeoutMs }
        );
        log.info("✓ Preview button is enabled");

        // Phase 3: Wait for LAUNCH button to be visible and enabled
        log.info("Waiting for Launch button to become enabled...");
        await this.page.waitForFunction(
            () => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent?.trim().toLowerCase() === 'launch') {
                        return btn.getAttribute('aria-disabled') !== 'true';
                    }
                }
                return false;
            },
            { timeout: timeoutMs }
        );
        log.info("✓ Launch button is enabled");

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log.info(`✅ App generation completed in ${elapsed}s`);
    }

    /**
     * Launch (publish) the generated application.
     * Clicks the "Launch" button on Rocket.new.
     */
    async publishApp(): Promise<void> {
        log.info("Launching (publishing) application...");

        await retryAsync(
            async () => {
                // Step 1: Wait for the header Launch button to be visible and enabled
                await this.launchButton.first().waitFor({ state: "visible", timeout: 30_000 });
                const isDisabled = await this.launchButton.first().getAttribute('aria-disabled');
                if (isDisabled === 'true') {
                    throw new Error("Launch button is still disabled — generation may not be complete");
                }

                // Step 2: Click the header Launch button to open the dropdown
                await sleep(1000);
                await this.launchButton.first().click();
                log.info("Header Launch button clicked — waiting for dropdown...");

                // Step 3: Wait for the dropdown to open
                const dropdownMenu = this.page.locator('[role="menu"][data-state="open"]');
                await dropdownMenu.waitFor({ state: "visible", timeout: 15_000 });
                log.info("Dropdown open — clicking inner Launch button to start deployment...");

                // Step 4: Click the "Launch" button INSIDE the dropdown
                // This button triggers the actual Netlify deployment
                const innerLaunchBtn = dropdownMenu.locator('button').filter({ hasText: /^Launch$/ });
                await innerLaunchBtn.waitFor({ state: "visible", timeout: 10_000 });
                await sleep(500);
                await innerLaunchBtn.click();
                log.info("✅ Inner Launch button clicked — deployment started");
            },
            {
                maxRetries: 2,
                delayMs: 3000,
                label: "Launch App",
            }
        );
    }

    /**
     * Extract the published URL after publishing.
     *
     * After publishApp() clicks the inner Launch button, the dropdown updates
     * to show the live URL. This method waits for that URL anchor to appear
     * and extracts it.
     */
    async getPublishedUrl(): Promise<string> {
        log.info("Waiting for deployment to complete and extracting published URL...");

        return await retryAsync(
            async () => {
                // Dropdown stays open after deployment — wait for it
                const dropdownMenu = this.page.locator('[role="menu"][data-state="open"]');
                await dropdownMenu.waitFor({ state: "visible", timeout: 120_000 });

                // Strategy 1: Wait for the URL anchor to appear (deployment complete indicator)
                // <a href="https://...builtwithrocket.new?rk_owner=true" aria-label="Visit published site: ...">
                const publishedLink = dropdownMenu.locator('a[aria-label*="Visit published site"]');
                await publishedLink.waitFor({ state: "visible", timeout: 120_000 });
                const url = await publishedLink.getAttribute('href');
                if (url && url.startsWith('http')) {
                    const cleanUrl = url.split('?')[0];
                    log.info(`✅ Published URL extracted (href): ${cleanUrl}`);
                    return cleanUrl;
                }

                // Strategy 2: <p> text inside the anchor
                const urlText = dropdownMenu.locator('a[aria-label*="Visit published site"] p');
                if (await urlText.isVisible({ timeout: 5_000 }).catch(() => false)) {
                    const text = await urlText.textContent();
                    if (text && text.trim().startsWith('http')) {
                        log.info(`✅ Published URL extracted (p text): ${text.trim()}`);
                        return text.trim();
                    }
                }

                // Strategy 3: Copy URL button → clipboard
                try {
                    const copyUrlBtn = dropdownMenu.locator('button[title="Copy URL"]');
                    if (await copyUrlBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
                        await copyUrlBtn.click();
                        log.debug("Clicked 'Copy URL' button");
                        await sleep(1000);
                        const clipboardUrl = await this.page.evaluate(() =>
                            navigator.clipboard.readText()
                        );
                        if (clipboardUrl && clipboardUrl.startsWith('http')) {
                            const cleanUrl = clipboardUrl.trim().split('?')[0];
                            log.info(`✅ Published URL extracted (clipboard): ${cleanUrl}`);
                            return cleanUrl;
                        }
                    }
                } catch {
                    log.debug("Clipboard read failed — trying next strategy");
                }

                // Strategy 4: regex on full page HTML
                const pageContent = await this.page.content();
                const urlMatch = pageContent.match(
                    /https?:\/\/[^\s"'<>]+\.public\.builtwithrocket\.new/
                );
                if (urlMatch) {
                    const cleanUrl = urlMatch[0].split('?')[0];
                    log.info(`✅ Published URL extracted (regex): ${cleanUrl}`);
                    return cleanUrl;
                }

                throw new Error("Could not extract published URL from the launch dropdown");
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

    // ══════════════════════════════════════════════════════════════════════════
    // ══ TEMP: Remove this entire block once script debugging is complete ══════
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * [TEMP / DEBUG ONLY]
     * Opens a previously generated app from the sidebar by name, clicks Launch,
     * waits for "Live" badge, and extracts the published URL.
     *
     * Use this to test the publish + URL extraction flow without
     * waiting 5+ mins for a new app to generate each time.
     *
     * @param chatName - The name of the chat/app to click in the sidebar (e.g. "ArunClothSphere")
     * @returns The published URL string
     */
    async debugGetUrlFromSidebarChat(chatName: string): Promise<string> {
        log.info(`[TEMP] Opening sidebar chat "${chatName}" to test publish flow...`);

        // 2. Click the chat item by name from the sidebar
        const chatItem = this.page.locator(`p.truncate:has-text("${chatName}")`);
        await chatItem.waitFor({ state: "visible", timeout: 10_000 });
        await chatItem.click();
        log.info(`[TEMP] Clicked chat: "${chatName}"`);
        await sleep(3000); // Wait for the chat/app to fully load

        // 3. Wait for Launch button to be visible and enabled
        log.info("[TEMP] Waiting for Launch button...");
        await this.launchButton.first().waitFor({ state: "visible", timeout: 30_000 });

        const isDisabled = await this.launchButton.first().getAttribute('aria-disabled');
        if (isDisabled === 'true') {
            throw new Error("[TEMP] Launch button is disabled — app may still be generating");
        }

        // 4. Click the Launch button — this opens a dropdown menu showing the published URL
        await sleep(1000);
        await this.launchButton.first().click();
        log.info("[TEMP] Launch button clicked — dropdown should now be open");

        // 5. Wait for the dropdown menu to appear (role="menu" with the URL inside)
        const dropdownMenu = this.page.locator('[role="menu"][data-state="open"]');
        await dropdownMenu.waitFor({ state: "visible", timeout: 15_000 });
        log.info("[TEMP] ✓ Launch dropdown is open");

        await sleep(1000);

        // 6. Extract the published URL from the anchor tag inside the dropdown
        // <a href="https://...builtwithrocket.new?rk_owner=true" aria-label="Visit published site: ...">
        const publishedLink = dropdownMenu.locator('a[aria-label*="Visit published site"]');
        if (await publishedLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
            const url = await publishedLink.getAttribute('href');
            if (url && url.startsWith('http')) {
                const cleanUrl = url.split('?')[0];
                log.info(`[TEMP] ✅ Published URL (href): ${cleanUrl}`);
                return cleanUrl;
            }
        }

        // Fallback A: read the <p> text inside the anchor
        const urlText = dropdownMenu.locator('a[aria-label*="Visit published site"] p');
        if (await urlText.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const text = await urlText.textContent();
            if (text && text.trim().startsWith('http')) {
                log.info(`[TEMP] ✅ Published URL (p text): ${text.trim()}`);
                return text.trim();
            }
        }

        // Fallback B: Copy URL button → clipboard
        try {
            const copyUrlBtn = dropdownMenu.locator('button[title="Copy URL"]');
            if (await copyUrlBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
                await copyUrlBtn.click();
                await sleep(1000);
                const clipboardUrl = await this.page.evaluate(() =>
                    navigator.clipboard.readText()
                );
                if (clipboardUrl && clipboardUrl.startsWith('http')) {
                    const cleanUrl = clipboardUrl.trim().split('?')[0];
                    log.info(`[TEMP] ✅ Published URL (clipboard): ${cleanUrl}`);
                    return cleanUrl;
                }
            }
        } catch {
            log.debug("[TEMP] Clipboard read failed");
        }

        // Fallback C: regex on full page HTML
        const pageContent = await this.page.content();
        const urlMatch = pageContent.match(
            /https?:\/\/[^\s"'<>]+\.public\.builtwithrocket\.new/
        );
        if (urlMatch) {
            const cleanUrl = urlMatch[0].split('?')[0];
            log.info(`[TEMP] ✅ Published URL (regex): ${cleanUrl}`);
            return cleanUrl;
        }

        throw new Error("[TEMP] Could not extract published URL from sidebar chat");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ══ END TEMP BLOCK ═══════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
}
