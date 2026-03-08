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

    // Rocket page-switcher dropdown (React-Select in the header showing current page e.g. "/homepage")
    private get rocketPageDropdown(): Locator {
        return this.page.locator('.project_dropdown__control');
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
                // ── Primary check: URL-based ──────────────────────────────────────
                // If the page did NOT redirect to /login, /signin or /auth,
                // the saved session is valid. This is reliable immediately after
                // navigation — no need to wait for React hydration.
                const currentUrl = this.page.url();
                const isOnLoginPage = /\/(login|signin|auth|sign-in)/i.test(currentUrl);

                if (isOnLoginPage) {
                    log.error(`Auth session expired — redirected to: ${currentUrl}`);
                    throw new Error(
                        "Google OAuth session expired. " +
                        "Run 'npx ts-node src/scripts/saveAuthState.ts' to login again."
                    );
                }

                // ── Secondary check: wait for any logged-in UI element ────────────
                // Give the React app up to 20s to hydrate and render the auth UI.
                const isLoggedIn = await this.page.locator(
                    '[class*="avatar"], [class*="user"], [class*="profile"], ' +
                    'button:has-text("New"), button:has-text("Create"), ' +
                    'img[alt*="avatar" i], img[alt*="profile" i], ' +
                    '[data-testid*="user"], [aria-label*="account" i]'
                ).first().isVisible({ timeout: 20_000 }).catch(() => false);

                if (isLoggedIn) {
                    log.info("✓ Already logged in via saved Google session");
                    return;
                }

                // ── Tertiary check: explicit Sign In button present → session gone ──
                const signInVisible = await this.page.locator(
                    'a:has-text("Sign in"), a:has-text("Login"), ' +
                    'button:has-text("Sign in"), button:has-text("Login"), ' +
                    'button:has-text("Get Started"), a:has-text("Get Started")'
                ).first().isVisible({ timeout: 5_000 }).catch(() => false);

                if (signInVisible) {
                    log.error("Auth session expired — Sign In button is visible");
                    throw new Error(
                        "Google OAuth session expired. " +
                        "Run 'npx ts-node src/scripts/saveAuthState.ts' to login again and save your session."
                    );
                }

                // ── Quaternary: page on rocket.new without a Sign-In button = logged in ──
                // React may still be loading the avatar. If we're on the right domain
                // and no login prompt is visible, treat it as authenticated.
                if (currentUrl.includes('rocket.new')) {
                    log.info("✓ Logged in (URL check passed, no sign-in prompt detected)");
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

        // Wait for the intermediate "Build my..." button to appear after analysis.
        // DOM confirmed: <button><div><div><p>Build my E-commerce store</p>...
        // The text lives inside a nested <p>, so we target button:has(p) with the text.
        log.info("Waiting for initial analysis to complete and 'Build my...' button to appear...");
        try {
            // Primary: target the button by the <p> it contains — unambiguous match.
            // Timeout raised to 3 minutes since Rocket's analysis can take >2 mins.
            const buildMyBtn = this.page.locator('button:has(p)').filter({ hasText: /build my/i }).first();
            await buildMyBtn.waitFor({ state: "visible", timeout: 360_000 });

            const btnText = (await buildMyBtn.textContent())?.trim();
            log.info(`'Build my...' button found: "${btnText}"`);

            await sleep(2000); // let the rightAnimation/arrowAnimate settle
            // force:true bypasses any intercepting animation overlay
            await buildMyBtn.click({ force: true });
            log.info("✅ Clicked 'Build my...' button — actual generation starting");
        } catch {
            // Take a debug screenshot so we can see what's on screen
            await this.takeScreenshot(`${definition.appName}_build_my_btn_missed`);
            log.warn(
                "Did not find 'Build my...' button within 3 minutes — screenshot saved. " +
                "Attempting DOM-level fallback click..."
            );

            // Fallback: evaluate() finds ANY leaf element whose text matches 'build my'
            // and clicks the closest <button> ancestor (or the element itself).
            const clicked = await this.page.evaluate(() => {
                const all = Array.from(document.querySelectorAll('p, span, div'));
                const match = all.find(el =>
                    /build my/i.test(el.textContent?.trim() ?? '')
                );
                if (match) {
                    // Walk up to find the nearest button ancestor
                    const btn = match.closest('button') ?? match as HTMLElement;
                    (btn as HTMLElement).click();
                    return (btn as HTMLElement).textContent?.trim()?.slice(0, 80);
                }
                return null;
            });

            if (clicked) {
                log.info(`Fallback DOM click succeeded — text: "${clicked}"`);
                await sleep(2000);
            } else {
                log.warn("Fallback also found nothing — assuming generation started automatically.");
            }
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
     * Extract all page endpoints that Rocket generated for this app.
     *
     * The header contains a React-Select dropdown (`project_dropdown__control`) that
     * lists every page Rocket built (e.g. /homepage, /cart, /admin/login).
     * Because React-Select collapses on ANY blur event, we cannot use Playwright
     * locators to iterate the options after clicking — they disappear before Playwright
     * can read them.  Instead we:
     *   1. Click the control to open it.
     *   2. Call `page.evaluate()` which runs synchronously inside the DOM with no blur.
     *   3. Press Escape to close cleanly without triggering navigation.
     */
    async getRocketGeneratedPages(): Promise<string[]> {
        log.info("Extracting Rocket-generated page endpoints from header dropdown...");

        try {
            // 0. The Launch dropdown may still be open from the URL extraction step.
            //    Press Escape to dismiss it cleanly, then wait 3s for the UI to settle
            //    before attempting to click the React page-switcher dropdown.
            log.info("Pressing Escape to dismiss any open dropdown before clicking page-switcher...");
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(3000);

            // 1. Wait for the project dropdown control to be visible
            await this.rocketPageDropdown.waitFor({ state: "visible", timeout: 15_000 });

            // 2. Click it to open the options list
            await this.rocketPageDropdown.click();
            await this.page.waitForTimeout(600); // small pause for React-Select to render options

            // 3. Read all options via DOM evaluation — no blur risk
            const pages = await this.page.evaluate(() => {
                const options = document.querySelectorAll('[class*="project_dropdown__option"]');
                return Array.from(options).map(el => el.textContent?.trim() ?? '');
            });

            // 4. Close the dropdown without navigating
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);

            // Keep only entries that look like URL paths (start with /)
            const filtered = pages.filter(p => p.startsWith('/'));
            log.info(`✅ Found ${filtered.length} Rocket-generated pages: ${filtered.join(', ')}`);
            return filtered;
        } catch (error) {
            log.warn(`Could not extract Rocket pages from dropdown: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    /**
     * Open the published application URL in a new tab within the same browser context.
     * Returns the new Page object so the caller can interact with or close it.
     */
    async openPublishedApp(publishedUrl: string): Promise<import('playwright').Page> {
        log.info(`Opening published app in new tab: ${publishedUrl}`);
        const newPage = await this.page.context().newPage();
        await newPage.goto(publishedUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await newPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
            log.warn('Network idle timeout on published app tab — proceeding anyway');
        });
        log.info(`✅ Published app loaded in new tab`);
        return newPage;
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
