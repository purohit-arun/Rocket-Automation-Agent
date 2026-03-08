import { AppDefinition } from "../config/config";
import { CSVStorageService } from "../services/csvStorage.service";
import { BrowserManager } from "../playwright/browserManager";
import { RocketPage } from "../playwright/rocketPage";
import { AnalysisAgent } from "./analysis.agent";
import { createLogger } from "../utils/logger";
import { sleep } from "../utils/retry";

const log = createLogger("RocketBuilderAgent");

/**
 * Agent responsible for Step 3:
 *  - Read app definitions from CSV
 *  - Login to Rocket.new
 *  - Create each application
 *  - Wait for generation
 *  - Publish each app
 *  - Store published URLs back to CSV
 */
export class RocketBuilderAgent {
    private csvService: CSVStorageService;
    private browserManager: BrowserManager;

    constructor(csvService: CSVStorageService) {
        this.csvService = csvService;
        this.browserManager = new BrowserManager();
    }

    /**
     * Execute the full build workflow.
     * @returns Updated definitions with published URLs.
     */
    async execute(): Promise<AppDefinition[]> {
        log.info("═══════════════════════════════════════════════════════════");
        log.info("STEP 3: Automated App Creation on Rocket.new");
        log.info("═══════════════════════════════════════════════════════════");

        // Read definitions from CSV
        const definitions = await this.csvService.readAppDefinitions();
        if (definitions.length === 0) {
            throw new Error("No app definitions found in CSV. Run Step 1 & 2 first.");
        }

        log.info(`Found ${definitions.length} apps to build`);

        let rocketPage: RocketPage | null = null;

        try {
            // Launch browser and create context
            await this.browserManager.launch();
            const context = await this.browserManager.newContext();
            const page = await context.newPage();
            rocketPage = new RocketPage(page);

            // Navigate and login
            await rocketPage.navigate();
            await rocketPage.login();

            // Shared analysis agent for page comparison
            const analysisAgent = new AnalysisAgent(this.csvService);

            // Build each app sequentially
            for (let i = 0; i < definitions.length; i++) {
                const def = definitions[i];
                log.info(`\n──── Building App ${i + 1}/${definitions.length}: "${def.appName}" ────`);

                try {
                    // ═══════════════════════════════════════════════════════════════════
                    // PRODUCTION FLOW — commented out (using sidebar shortcut instead)
                    // ═══════════════════════════════════════════════════════════════════
                    // await rocketPage.createApp(def);
                    // await rocketPage.waitForGeneration();
                    // await rocketPage.takeScreenshot(`${def.appName}_generated`).catch((e) =>
                    //     log.warn(`Could not save generated screenshot: ${e.message}`)
                    // );
                    // await rocketPage.publishApp();
                    // const publishedUrl = await rocketPage.getPublishedUrl();
                    // def.publishedUrl = publishedUrl;
                    // ═══════════════════════════════════════════════════════════════════

                    // ═══════════════════════════════════════════════════════════════════
                    // SIDEBAR SHORTCUT — pick existing app instead of generating
                    // ═══════════════════════════════════════════════════════════════════
                    const publishedUrl = await rocketPage.debugGetUrlFromSidebarChat("ArunClothSphere");
                    def.publishedUrl = publishedUrl;
                    log.info(`Published URL from sidebar: ${publishedUrl}`);
                    // ═══════════════════════════════════════════════════════════════════

                    // Extract all page endpoints Rocket generated (from header dropdown)
                    const rocketPages = await rocketPage.getRocketGeneratedPages();
                    log.info(`Rocket pages (${rocketPages.length}): ${rocketPages.join(', ')}`);

                    // Open the published app in a new tab in the same browser context
                    const publishedPage = await rocketPage.openPublishedApp(publishedUrl);

                    // Store URL back to CSV — close Excel/other apps before this runs!
                    await this.csvService.updatePublishedUrl(def.appName, publishedUrl);

                    // Navigate to each Rocket-generated endpoint in the published tab,
                    // verify DOM loads, then write Found/Missing summary to CSV
                    await analysisAgent.compareAndWritePageResults(def, rocketPages, publishedUrl, publishedPage);

                    log.info(`✓ App "${def.appName}" built, published and verified: ${publishedUrl}`);

                    // Navigate back to home for next app
                    if (i < definitions.length - 1) {
                        await rocketPage.navigate();
                        await sleep(2000);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    log.error(`✗ Failed to build app "${def.appName}": ${errorMsg}`);

                    // Check if the page/browser is still open before attempting a screenshot
                    const pageStillOpen = await rocketPage.page.evaluate(() => true).catch(() => false);

                    if (pageStillOpen) {
                        // Take error screenshot — page is still alive
                        await rocketPage.takeScreenshot(`${def.appName}_error`).catch((e) =>
                            log.warn(`Could not save error screenshot: ${e.message}`)
                        );

                        // Only navigate back if there are more apps to process
                        if (i < definitions.length - 1) {
                            try {
                                await rocketPage.navigate();
                            } catch {
                                log.warn("Failed to navigate back — reopening page");
                                const newPage = await this.browserManager.getContext()!.newPage();
                                rocketPage = new RocketPage(newPage);
                                await rocketPage.navigate();
                                await rocketPage.login();
                            }
                        }
                    } else {
                        log.warn(`Browser/page was closed externally for "${def.appName}" — skipping recovery navigation`);
                    }
                }
            }
        } finally {
            await this.browserManager.close();
        }

        const successCount = definitions.filter((d) => d.publishedUrl).length;
        log.info(`\nBuild complete: ${successCount}/${definitions.length} apps published successfully`);

        return definitions;
    }
}
