import { Page, BrowserContext, ConsoleMessage } from "playwright";
import { AppDefinition, AnalysisResult, config } from "../config/config";
import { CSVStorageService } from "../services/csvStorage.service";
import { BrowserManager } from "../playwright/browserManager";
import { createLogger } from "../utils/logger";
import { retryAsync, sleep } from "../utils/retry";
import fs from "fs";

const log = createLogger("AnalysisAgent");

/**
 * Agent responsible for Step 4 + Step 5:
 *  - Visit each published app
 *  - Analyze pages, navigation, modules, console errors, broken links, UI issues
 *  - Generate a comparison report
 *  - Write results back to CSV
 */
export class AnalysisAgent {
    private csvService: CSVStorageService;
    private browserManager: BrowserManager;

    constructor(csvService: CSVStorageService) {
        this.csvService = csvService;
        this.browserManager = new BrowserManager();
    }

    /**
     * Analyze all published applications and generate reports.
     */
    async execute(): Promise<AnalysisResult[]> {
        log.info("═══════════════════════════════════════════════════════════");
        log.info("STEP 4 & 5: Application Analysis and Report Generation");
        log.info("═══════════════════════════════════════════════════════════");

        const definitions = await this.csvService.readAppDefinitions();
        const publishedApps = definitions.filter((d) => d.publishedUrl);

        if (publishedApps.length === 0) {
            log.warn("No published apps found for analysis. Skipping.");
            return [];
        }

        log.info(`Analyzing ${publishedApps.length} published applications`);
        const results: AnalysisResult[] = [];

        try {
            await this.browserManager.launch();
            const context = await this.browserManager.newContext();

            for (let i = 0; i < publishedApps.length; i++) {
                const app = publishedApps[i];
                log.info(
                    `\n──── Analyzing App ${i + 1}/${publishedApps.length}: "${app.appName}" ────`
                );
                log.info(`URL: ${app.publishedUrl}`);

                try {
                    const result = await this.analyzeApp(context, app);
                    results.push(result);
                    log.info(
                        `✓ Analysis complete for "${app.appName}" — Status: ${result.overallStatus}`
                    );
                } catch (error) {
                    const errorMsg =
                        error instanceof Error ? error.message : String(error);
                    log.error(`✗ Analysis failed for "${app.appName}": ${errorMsg}`);

                    // Create a failed result
                    results.push({
                        appName: app.appName,
                        expectedPages: app.pages,
                        actualPages: [],
                        missingModules: app.modules,
                        brokenFeatures: [`Analysis failed: ${errorMsg}`],
                        uiIssues: [],
                        consoleErrors: [],
                        brokenLinks: [],
                        overallStatus: "FAIL",
                    });
                }
            }
        } finally {
            await this.browserManager.close();
        }

        // Write analysis results to CSV
        await this.csvService.writeAnalysisResults(results);
        const reportPath = await this.csvService.writeAnalysisReport(results);

        // Print summary
        this.printSummary(results);
        log.info(`Detailed report saved: ${reportPath}`);

        return results;
    }

    /**
     * Analyze a single published application.
     */
    private async analyzeApp(
        context: BrowserContext,
        app: AppDefinition
    ): Promise<AnalysisResult> {
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const consoleWarnings: string[] = [];

        // Collect console errors
        page.on("console", (msg: ConsoleMessage) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
            }
            if (msg.type() === "warning") {
                consoleWarnings.push(msg.text());
            }
        });

        // Collect page errors
        page.on("pageerror", (error: Error) => {
            consoleErrors.push(`Page Error: ${error.message}`);
        });

        try {
            // Navigate to the published app
            await retryAsync(
                async () => {
                    await page.goto(app.publishedUrl!, {
                        waitUntil: "domcontentloaded",
                        timeout: 60_000,
                    });
                    await page
                        .waitForLoadState("networkidle", { timeout: 15_000 })
                        .catch(() => { });
                },
                {
                    maxRetries: 2,
                    delayMs: 3000,
                    label: `Navigate to ${app.appName}`,
                }
            );

            await sleep(3000); // Allow dynamic content to render

            // Run all analysis checks
            const [actualPages, brokenLinks, uiIssues] = await Promise.all([
                this.detectActualPages(page),
                this.detectBrokenLinks(page),
                this.detectUIIssues(page),
            ]);

            // Check navigation
            const navigationIssues = await this.checkNavigation(page, app.pages);

            // Find missing modules
            const missingModules = this.findMissingModules(
                app.modules,
                await page.content()
            );

            // Check for broken features
            const brokenFeatures = await this.checkFeatures(page, app.features);

            // Take screenshot
            const screenshotPath = await this.takeAnalysisScreenshot(
                page,
                app.appName
            );

            // Combine UI issues with navigation issues
            const allUiIssues = [...uiIssues, ...navigationIssues];

            // Determine overall status
            const overallStatus = this.determineStatus(
                missingModules,
                brokenFeatures,
                consoleErrors,
                brokenLinks,
                allUiIssues
            );

            return {
                appName: app.appName,
                expectedPages: app.pages,
                actualPages,
                missingModules,
                brokenFeatures,
                uiIssues: allUiIssues,
                consoleErrors: consoleErrors.slice(0, 20), // Limit to 20
                brokenLinks,
                overallStatus,
                screenshotPath,
            };
        } finally {
            await page.close();
        }
    }

    /**
     * Detect actual pages/routes in the application.
     */
    private async detectActualPages(page: Page): Promise<string[]> {
        const pages: string[] = [];

        try {
            // Find all navigation links
            const links = await page.locator("a[href], nav a, [role='navigation'] a").all();

            for (const link of links) {
                try {
                    const href = await link.getAttribute("href");
                    const text = await link.textContent();
                    if (href && text && !href.startsWith("http") && href !== "#") {
                        pages.push(text.trim());
                    } else if (href && text && href.includes(page.url().split("/")[2])) {
                        pages.push(text.trim());
                    }
                } catch {
                    // Skip inaccessible links
                }
            }

            // Also check for visible section headers as "pages"
            const headers = await page
                .locator("h1, h2, [role='heading']")
                .allTextContents();
            const currentPage = headers[0]?.trim();
            if (currentPage && !pages.includes(currentPage)) {
                pages.unshift(currentPage);
            }
        } catch (error) {
            log.warn("Failed to detect pages", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return [...new Set(pages.filter((p) => p.length > 0))]; // Deduplicate
    }

    /**
     * Detect broken links in the application.
     */
    private async detectBrokenLinks(page: Page): Promise<string[]> {
        const brokenLinks: string[] = [];

        try {
            const links = await page.locator("a[href]").all();

            for (const link of links) {
                try {
                    const href = await link.getAttribute("href");
                    if (
                        href &&
                        href.startsWith("http") &&
                        !href.includes("javascript:")
                    ) {
                        const response = await page.request.get(href, { timeout: 10_000 });
                        if (response.status() >= 400) {
                            brokenLinks.push(`${href} (${response.status()})`);
                        }
                    }
                } catch (error) {
                    const href = await link.getAttribute("href").catch(() => "unknown");
                    brokenLinks.push(`${href} (network error)`);
                }
            }
        } catch (error) {
            log.warn("Broken link detection failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return brokenLinks.slice(0, 10); // Limit results
    }

    /**
     * Detect UI layout issues.
     */
    private async detectUIIssues(page: Page): Promise<string[]> {
        const issues: string[] = [];

        try {
            // Check for overflow issues
            const overflowElements = await page.evaluate(() => {
                const elements = document.querySelectorAll("*");
                let overflowCount = 0;
                elements.forEach((el) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.right > window.innerWidth || rect.left < 0) {
                        overflowCount++;
                    }
                });
                return overflowCount;
            });

            if (overflowElements > 0) {
                issues.push(`${overflowElements} elements with horizontal overflow`);
            }

            // Check for missing images
            const brokenImages = await page.evaluate(() => {
                const images = document.querySelectorAll("img");
                let broken = 0;
                images.forEach((img) => {
                    if (!img.complete || img.naturalWidth === 0) {
                        broken++;
                    }
                });
                return broken;
            });

            if (brokenImages > 0) {
                issues.push(`${brokenImages} broken/missing images`);
            }

            // Check for empty containers
            const emptyContainers = await page.evaluate(() => {
                const containers = document.querySelectorAll(
                    "main, section, article, div[class*='content'], div[class*='container']"
                );
                let empty = 0;
                containers.forEach((el) => {
                    if (el.textContent?.trim() === "" && el.children.length === 0) {
                        empty++;
                    }
                });
                return empty;
            });

            if (emptyContainers > 0) {
                issues.push(`${emptyContainers} empty content containers`);
            }

            // Check viewport scaling
            const hasViewportMeta = await page.evaluate(() => {
                return !!document.querySelector('meta[name="viewport"]');
            });

            if (!hasViewportMeta) {
                issues.push("Missing viewport meta tag (not responsive)");
            }
        } catch (error) {
            log.warn("UI issue detection partially failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return issues;
    }

    /**
     * Check if navigation between pages works.
     */
    private async checkNavigation(
        page: Page,
        expectedPages: string[]
    ): Promise<string[]> {
        const issues: string[] = [];

        try {
            const navLinks = await page.locator("nav a, [role='navigation'] a, header a").all();

            if (navLinks.length === 0) {
                issues.push("No navigation links found");
                return issues;
            }

            for (const link of navLinks.slice(0, 5)) {
                // Test first 5 links
                try {
                    const text = (await link.textContent())?.trim();
                    const isVisible = await link.isVisible();
                    const isEnabled = await link.isEnabled();

                    if (!isVisible) {
                        issues.push(`Nav link "${text}" is not visible`);
                    }
                    if (!isEnabled) {
                        issues.push(`Nav link "${text}" is disabled`);
                    }
                } catch {
                    // Skip inaccessible links
                }
            }
        } catch (error) {
            issues.push("Navigation check failed");
        }

        return issues;
    }

    /**
     * Find modules that appear to be missing from the page content.
     */
    private findMissingModules(
        expectedModules: string[],
        pageContent: string
    ): string[] {
        const contentLower = pageContent.toLowerCase();
        return expectedModules.filter((module) => {
            const moduleLower = module.toLowerCase();
            // Check if module name or close variant exists in page
            const words = moduleLower.split(/[\s-_]+/);
            return !words.some(
                (word) => word.length > 3 && contentLower.includes(word)
            );
        });
    }

    /**
     * Check feature availability (heuristic-based).
     */
    private async checkFeatures(
        page: Page,
        expectedFeatures: string[]
    ): Promise<string[]> {
        const brokenFeatures: string[] = [];
        const pageContent = (await page.content()).toLowerCase();

        for (const feature of expectedFeatures) {
            const featureLower = feature.toLowerCase();
            const keywords = featureLower
                .split(/[\s,]+/)
                .filter((w) => w.length > 3);

            const found = keywords.some((kw) => pageContent.includes(kw));
            if (!found) {
                brokenFeatures.push(`Potentially missing: ${feature}`);
            }
        }

        return brokenFeatures;
    }

    /**
     * Take a screenshot for analysis.
     */
    private async takeAnalysisScreenshot(
        page: Page,
        appName: string
    ): Promise<string> {
        try {
            const sanitized = appName.replace(/[^a-zA-Z0-9_-]/g, "_");
            const screenshotPath = `${config.screenshotsDir}/${sanitized}_analysis_${Date.now()}.png`;

            if (!fs.existsSync(config.screenshotsDir)) {
                fs.mkdirSync(config.screenshotsDir, { recursive: true });
            }

            await page.screenshot({ path: screenshotPath, fullPage: true });
            log.debug(`Analysis screenshot saved: ${screenshotPath}`);
            return screenshotPath;
        } catch (error) {
            log.warn("Screenshot capture failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return "";
        }
    }

    /**
     * Determine overall pass/fail status.
     */
    private determineStatus(
        missingModules: string[],
        brokenFeatures: string[],
        consoleErrors: string[],
        brokenLinks: string[],
        uiIssues: string[]
    ): "PASS" | "FAIL" | "PARTIAL" {
        const totalIssues =
            missingModules.length +
            brokenFeatures.length +
            consoleErrors.length +
            brokenLinks.length +
            uiIssues.length;

        if (totalIssues === 0) return "PASS";
        if (
            missingModules.length > 3 ||
            brokenLinks.length > 3 ||
            consoleErrors.length > 5
        ) {
            return "FAIL";
        }
        return "PARTIAL";
    }

    /**
     * For each endpoint extracted from the Rocket header dropdown, navigate to
     * `publishedUrl + endpoint` in the already-open published-app tab and verify
     * that the page's DOM content actually loads. Then write a formatted
     * Found / Missing summary into the CSV "Analysis Result" column (single cell).
     *
     * @param def           - AppDefinition from CSV (used for app name)
     * @param rocketPages   - Endpoints from the Rocket header dropdown (e.g. ["/homepage", "/cart"])
     * @param publishedUrl  - Base published URL (e.g. "https://xxx.builtwithrocket.new")
     * @param publishedPage - The already-open browser tab pointing at the published app
     */
    async compareAndWritePageResults(
        def: AppDefinition,
        rocketPages: string[],
        publishedUrl: string,
        publishedPage: import('playwright').Page
    ): Promise<void> {
        log.info(`Verifying ${rocketPages.length} page endpoints for "${def.appName}"...`);

        // ── Wait for Netlify CDN to propagate the freshly published site ──────
        // Freshly published Rocket.new apps can take 3-5 minutes to go live.
        // Strategy: initial 4-minute wait, then reload up to 3 times (30s apart)
        // until the base URL returns a non-error page, before checking endpoints.
        log.info(`Waiting 4 minutes for "${def.appName}" to go live on Netlify CDN...`);
        await publishedPage.goto(publishedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });
        await publishedPage.waitForTimeout(240_000); // 4 minute initial propagation wait

        log.info('Starting up-to-3 reload retries to confirm site is live...');
        let siteIsLive = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            await publishedPage.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => { });

            const bodyText = await publishedPage.evaluate(() => document.body?.innerText ?? '').catch(() => '');
            const isErrorPage = /site not found|page not found|not found on netlify|broken link/i.test(bodyText.slice(0, 2000));

            if (!isErrorPage) {
                log.info(`✅ Site is live after reload attempt ${attempt}/${3}`);
                siteIsLive = true;
                break;
            }

            log.warn(`⚠ Reload attempt ${attempt}/3 — site still not live, waiting 30s...`);
            if (attempt < 3) await publishedPage.waitForTimeout(30_000);
        }

        if (!siteIsLive) {
            log.warn(`Site did not come up after 4 min + 3 retries — proceeding anyway (pages will be marked MISSING if site is down)`);
        }

        log.info('Starting per-endpoint verification...');

        const foundPages: string[] = [];
        const missingPages: string[] = [];

        for (const endpoint of rocketPages) {
            // Ensure endpoint starts with / and build the full URL
            const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            const fullUrl = `${publishedUrl.replace(/\/+$/, '')}${normalizedEndpoint}`;

            try {
                log.info(`  Navigating to: ${fullUrl}`);
                const response = await publishedPage.goto(fullUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 15_000,
                });

                // ── Check 1: HTTP status ──────────────────────────────────────────
                // Netlify / hosting providers return valid HTML even for 404s,
                // so `domcontentloaded` always fires. We must check the status code.
                if (!response || !response.ok()) {
                    const status = response?.status() ?? 'no response';
                    log.warn(`  ⚠ HTTP ${status} for ${endpoint} → MISSING`);
                    missingPages.push(endpoint);
                    continue;
                }

                // ── Check 2: Page body error-text scan ───────────────────────────
                // Some hosts (Netlify, Vercel) serve a branded 404 page with HTTP 200.
                // Detect those by scanning for known error phrases.
                const bodyText = await publishedPage.evaluate(
                    () => document.body?.innerText ?? ''
                );
                const isErrorPage = /site not found|page not found|404|not found|broken link/i
                    .test(bodyText.slice(0, 2000)); // only check first 2000 chars

                if (isErrorPage) {
                    log.warn(`  ⚠ Error page content detected for ${endpoint} → MISSING`);
                    missingPages.push(endpoint);
                    continue;
                }

                log.info(`  ✅ Loaded OK (HTTP ${response.status()}): ${endpoint}`);
                foundPages.push(endpoint);

            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                log.warn(`  ⚠ Navigation error for ${endpoint}: ${msg} → MISSING`);
                missingPages.push(endpoint);
            }
        }

        // Build a single formatted string for the CSV cell.
        // A newline inside a quoted CSV field renders as a line-break in Excel.
        const foundStr = foundPages.length ? foundPages.join(', ') : 'none';
        const missingStr = missingPages.length ? missingPages.join(', ') : 'none';
        const summary = `Found Pages: ${foundStr}\nMissing Pages: ${missingStr}`;

        log.info(`Page verification complete for "${def.appName}":`);
        log.info(`  Found   (${foundPages.length}): ${foundStr}`);
        log.info(`  Missing (${missingPages.length}): ${missingStr}`);

        await this.csvService.updateAnalysisResult(def.appName, summary);
        log.info(`✅ Analysis Result written to CSV for "${def.appName}"`);
    }

    /**
     * Print a summary table of analysis results.
     */
    private printSummary(results: AnalysisResult[]): void {
        log.info("\n═══════════════════════════════════════════════════════════");
        log.info("                  ANALYSIS SUMMARY");
        log.info("═══════════════════════════════════════════════════════════");

        for (const r of results) {
            log.info(`\n📱 ${r.appName} — ${r.overallStatus}`);
            log.info(`   Expected Pages: ${r.expectedPages.length} | Actual: ${r.actualPages.length}`);
            log.info(`   Missing Modules: ${r.missingModules.length}`);
            log.info(`   Broken Features: ${r.brokenFeatures.length}`);
            log.info(`   Console Errors:  ${r.consoleErrors.length}`);
            log.info(`   Broken Links:    ${r.brokenLinks.length}`);
            log.info(`   UI Issues:       ${r.uiIssues.length}`);
        }

        const passed = results.filter((r) => r.overallStatus === "PASS").length;
        const partial = results.filter((r) => r.overallStatus === "PARTIAL").length;
        const failed = results.filter((r) => r.overallStatus === "FAIL").length;

        log.info("\n───────────────────────────────────────────────────────────");
        log.info(`TOTAL: ${results.length} apps | ✓ ${passed} PASS | ⚠ ${partial} PARTIAL | ✗ ${failed} FAIL`);
        log.info("═══════════════════════════════════════════════════════════\n");
    }
}
