import { test, expect } from "@playwright/test";
import { AutomationRunner } from "../src/runner/automationRunner";
import { AutomationInput } from "../src/config/config";

/**
 * Rocket.new Automation Agent — Playwright Test Entrypoint
 *
 * Run with: npx playwright test tests/runAutomation.spec.ts
 *
 * Configure the input parameters below or override via environment variables:
 *   NUM_APPS=3 TECHNOLOGY=React USE_CASE="Web App" APP_TYPE="Ecommerce Clothing Store" npx playwright test
 */

// ─── Input Configuration ──────────────────────────────────────────────────────
const automationInput: AutomationInput = {
    numberOfApps: parseInt(process.env.NUM_APPS || "3", 10),
    technology: process.env.TECHNOLOGY || "React",
    useCase: process.env.USE_CASE || "Web App",
    type: process.env.APP_TYPE || "Ecommerce Clothing Store",
};

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
    test.setTimeout(10 * 60 * 1000); // 10 minutes per step

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

    test("Step 3 — Build and Publish Apps on Rocket.new", async () => {
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
