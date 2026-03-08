import { test, expect } from "@playwright/test";
import { AutomationRunner } from "../src/runner/automationRunner";
import { AutomationInput } from "../src/config/config";

/**
 * Rocket.new Automation Agent — Playwright Test Entrypoint
 *
 * DO NOT run directly. Use the interactive launcher instead:
 *   node run.js
 *
 * run.js prompts for the 4 inputs, then launches Playwright
 * with those values passed as environment variables.
 */

function collectUserInput(): AutomationInput {
    // Values come from env vars injected by run.js (which prompted the user)
    return {
        numberOfApps: parseInt(process.env.NUM_APPS || "1", 10),
        useCase: process.env.USE_CASE || "Web App",
        technology: process.env.TECHNOLOGY || "NextJS / React",
        type: process.env.APP_TYPE || "E-commerce",
    };
}

// ─── Collect Input Once (synchronously) Before All Tests Run ─────────────────
const automationInput: AutomationInput = collectUserInput();

// ─── Full Pipeline Test ───────────────────────────────────────────────────────
test.describe("Rocket.new Automation Agent", () => {
    test.setTimeout(30 * 60 * 1000); // 30 minutes for full pipeline

    let runner: AutomationRunner;

    test.beforeAll(() => {
        runner = new AutomationRunner();
    });

    test("Full Pipeline — Generate, Build, Publish, Analyze", async () => {
        const result = await runner.run(automationInput);

        // Assertions
        expect(result.definitions.length).toBe(automationInput.numberOfApps);
        expect(result.definitions.length).toBeGreaterThan(0);

        // At least one app should have been published
        const publishedCount = result.definitions.filter(
            (d) => d.publishedUrl
        ).length;
        expect(publishedCount).toBeGreaterThan(0);

        // Analysis should have run
        expect(result.analysisResults.length).toBeGreaterThan(0);

        console.log("\n═══ AUTOMATION COMPLETE ═══");
        console.log(`Apps defined:   ${result.definitions.length}`);
        console.log(`Apps published: ${publishedCount}`);
        console.log(`Apps analyzed:  ${result.analysisResults.length}`);
    });
});

// ─── Individual Step Tests ────────────────────────────────────────────────────
test.describe("Individual Steps", () => {
    test.setTimeout(25 * 60 * 1000); // 25 minutes — covers full generation + publish + verify flow

    let runner: AutomationRunner;

    test.beforeAll(() => {
        runner = new AutomationRunner();
    });

    test("Step 1 & 2 — Generate App Definitions Only", async () => {
        const definitions = await runner.runDefinitionOnly(automationInput);

        expect(definitions.length).toBe(automationInput.numberOfApps);

        for (const def of definitions) {
            expect(def.appName).toBeTruthy();
            expect(def.overview).toBeTruthy();
            expect(def.modules.length).toBeGreaterThan(0);
            expect(def.pages.length).toBeGreaterThan(0);
            expect(def.features.length).toBeGreaterThan(0);
            expect(def.functionalRequirements.length).toBeGreaterThan(0);
        }

        console.log("Definitions generated:");
        definitions.forEach((d, i) => {
            console.log(`  [${i + 1}] ${d.appName} — ${d.pages.length} pages, ${d.modules.length} modules`);
        });
    });

    // ══ ORIGINAL Step 3 ═══════════════════════════════════════════════════════
    test("Step 3 — Build and Publish Apps on Rocket.new", async () => {
        // Override to 25 min: prompt entry (~1m) + Rocket analysis (~3m)
        // + generation (~5m) + publish (~2m) + page verification (~2m) = ~13m per app.
        // 25 min gives comfortable headroom for 1-2 apps.
        test.setTimeout(25 * 60 * 1000);
        const definitions = await runner.runBuildOnly();

        const publishedCount = definitions.filter((d) => d.publishedUrl).length;
        expect(publishedCount).toBeGreaterThan(0);

        console.log("Published apps:");
        definitions
            .filter((d) => d.publishedUrl)
            .forEach((d) => {
                console.log(`  ✓ ${d.appName}: ${d.publishedUrl}`);
            });
    });
    // ══════════════════════════════════════════════════════════════════════════

    // ══ TEMP (commented out — debug only) ════════════════════════════════════
    // test("Step 3 — Build and Publish Apps on Rocket.new", async () => {
    //     const { BrowserManager } = await import("../src/playwright/browserManager");
    //     const { RocketPage } = await import("../src/playwright/rocketPage");
    //
    //     const browserManager = new BrowserManager();
    //
    //     try {
    //         await browserManager.launch();
    //         const context = await browserManager.newContext();
    //         const page = await context.newPage();
    //         const rocketPage = new RocketPage(page);
    //
    //         await rocketPage.navigate();
    //         await rocketPage.login();
    //
    //         // Use temp method: open sidebar chat by name and extract published URL
    //         const publishedUrl = await rocketPage.debugGetUrlFromSidebarChat("ArunClothSphere");
    //
    //         expect(publishedUrl).toBeTruthy();
    //         expect(publishedUrl).toContain("builtwithrocket.new");
    //
    //         console.log(`\n✅ Published URL extracted: ${publishedUrl}`);
    //
    //         // Open the extracted URL in a new tab to verify
    //         console.log(`\n[TEMP] Opening new tab to verify published app...`);
    //         const publishedPage = await context.newPage();
    //         await publishedPage.goto(publishedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    //         await publishedPage.waitForTimeout(5000);
    //     } finally {
    //         await browserManager.close();
    //     }
    // });
    // ══ END TEMP ══════════════════════════════════════════════════════════════

    test("Step 4 & 5 — Analyze Published Apps", async () => {
        const results = await runner.runAnalysisOnly();

        expect(results.length).toBeGreaterThan(0);

        console.log("Analysis results:");
        results.forEach((r) => {
            console.log(`  ${r.overallStatus === "PASS" ? "✓" : "✗"} ${r.appName}: ${r.overallStatus}`);
        });
    });
});

// ─── Smoke Test (No External Dependencies) ────────────────────────────────────
test.describe("Smoke Tests", () => {
    test("smoke — imports resolve and config loads", async () => {
        // Validate imports work
        expect(AutomationRunner).toBeDefined();
        expect(automationInput).toBeDefined();
        expect(automationInput.numberOfApps).toBeGreaterThan(0);
        expect(automationInput.technology).toBeTruthy();

        console.log("Smoke test passed — all imports resolve correctly");
    });
});
