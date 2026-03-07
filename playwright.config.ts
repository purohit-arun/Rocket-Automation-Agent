import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: 1,
    reporter: [["html", { open: "never" }], ["list"]],
    timeout: 5 * 60 * 1000, // 5 minutes — app generation can be slow
    expect: {
        timeout: 30_000,
    },
    use: {
        baseURL: process.env.BASE_URL || "https://rocket.new",
        headless: false,
        viewport: null,
        launchOptions: {
            args: ["--start-maximized"],
        },
        actionTimeout: 0, // 0 means no timeout (wait for test timeout instead)
        navigationTimeout: 0,
        screenshot: "on",
        video: "retain-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                channel: "chrome",
            },
        },
    ],
    outputDir: "./test-results",
});
