/**
 * Save Auth State Script
 * ──────────────────────
 * One-time helper script to capture your Google OAuth session for Rocket.new.
 *
 * BYPASSES GOOGLE'S SECURITY BLOCK by:
 *  - Using your real installed Chrome (not Playwright's Chromium)
 *  - Using a persistent browser profile (looks like a real user)
 *  - Disabling automation flags that Google detects
 *
 * HOW IT WORKS:
 *  1. Opens your real Chrome browser with a persistent profile
 *  2. Navigates to Rocket.new
 *  3. YOU manually sign in with your Google account
 *  4. Once logged in, press Enter in the terminal
 *  5. The script saves your cookies/localStorage to auth/storageState.json
 *  6. All subsequent automation runs reuse this saved session
 *
 * USAGE:
 *   npx ts-node src/scripts/saveAuthState.ts
 *
 * NOTE: Re-run this script whenever your session expires.
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import readline from "readline";

dotenv.config();

const AUTH_DIR = path.resolve(__dirname, "..", "..", "auth");
const AUTH_STATE_PATH =
    process.env.AUTH_STATE_PATH ||
    path.resolve(AUTH_DIR, "storageState.json");
const BROWSER_PROFILE_DIR = path.resolve(AUTH_DIR, "chrome-profile");
const BASE_URL = process.env.BASE_URL || "https://rocket.new";

async function waitForEnter(prompt: string): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(prompt, () => {
            rl.close();
            resolve();
        });
    });
}

async function main(): Promise<void> {
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║     ROCKET.NEW — Google Auth State Saver (Chrome)        ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log();
    console.log("This script opens your REAL Chrome browser (not Playwright Chromium).");
    console.log("This bypasses Google's 'browser not secure' block.");
    console.log();
    console.log("Please sign in to Rocket.new using your Google account.");
    console.log("After you are fully logged in, come back here and press Enter.");
    console.log();

    // Ensure directories exist
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    // Use launchPersistentContext with real Chrome
    // This creates a real Chrome profile that Google trusts
    console.log("🚀 Launching Chrome with persistent profile...");
    console.log(`   Profile directory: ${BROWSER_PROFILE_DIR}`);
    console.log();

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        channel: "chrome",           // Use real installed Chrome, not Playwright Chromium
        headless: false,
        viewport: null,               // Use full window size
        args: [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",  // Hide automation flag
        ],
        ignoreDefaultArgs: ["--enable-automation"],  // Remove "Chrome is controlled by automated software" bar
    });

    const page = context.pages()[0] || await context.newPage();

    // Navigate to Rocket.new
    console.log(`🌐 Opening ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    console.log();
    console.log("═══════════════════════════════════════════════════════════");
    console.log("👆 Chrome has opened with Rocket.new.");
    console.log();
    console.log("   1. Click 'Continue with Google' on the sign-in popup");
    console.log("   2. Sign in with your Google account");
    console.log("   3. Wait until you see the Rocket.new dashboard");
    console.log("   4. Come back to this terminal");
    console.log();
    console.log("   ⚡ Since this is real Chrome, Google login will work!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log();

    await waitForEnter("✅ Press ENTER after you have successfully logged in... ");

    // Verify the user is actually logged in
    const pageUrl = page.url();
    console.log(`\n📍 Current URL: ${pageUrl}`);

    // Save the auth state (cookies + localStorage)
    console.log(`💾 Saving auth state to: ${AUTH_STATE_PATH}`);
    await context.storageState({ path: AUTH_STATE_PATH });

    console.log();
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║  ✓ Auth state saved successfully!                        ║");
    console.log("║                                                           ║");
    console.log("║  You can now run the automation:                          ║");
    console.log("║  npx playwright test tests/runAutomation.spec.ts          ║");
    console.log("║                                                           ║");
    console.log("║  Re-run this script if your session expires.              ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");

    await context.close();
}

main().catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
});
