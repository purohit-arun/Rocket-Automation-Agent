#!/usr/bin/env node
/**
 * Rocket.new Automation Agent — Interactive Launcher
 *
 * Usage:  node run.js
 *
 * Prompts for the 4 inputs, then launches Playwright with those values
 * so the test always gets exactly what you typed.
 */

const readline = require("readline");
const { spawnSync } = require("child_process");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║   Rocket.new Automation Agent — Setup        ║");
    console.log("╚══════════════════════════════════════════════╝\n");

    const numAppsRaw = await ask("  Number of Apps        (default: 1)              : ");
    const useCaseRaw = await ask("  Use Case              (default: Web App)         : ");
    const techRaw = await ask("  Technology            (default: NextJS / React)  : ");
    const appTypeRaw = await ask("  Type of Application   (default: E-commerce)      : ");

    rl.close();

    const numApps = numAppsRaw.trim() || "1";
    const useCase = useCaseRaw.trim() || "Web App";
    const tech = techRaw.trim() || "NextJS / React";
    const appType = appTypeRaw.trim() || "E-commerce";

    console.log("\n  ──────────────────────────────────────────────");
    console.log(`  Number of Apps     : ${numApps}`);
    console.log(`  Use Case           : ${useCase}`);
    console.log(`  Technology         : ${tech}`);
    console.log(`  Type of Application: ${appType}`);
    console.log("  ──────────────────────────────────────────────\n");
    console.log("  Launching Playwright...\n");

    // Pass values as env vars into the Playwright process
    const result = spawnSync(
        "npx",
        ["playwright", "test", "tests/runAutomation.spec.ts"],
        {
            stdio: "inherit",
            shell: true,
            env: {
                ...process.env,
                NUM_APPS: numApps,
                USE_CASE: useCase,
                TECHNOLOGY: tech,
                APP_TYPE: appType,
            },
        }
    );

    process.exit(result.status ?? 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
