import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface AutomationInput {
    numberOfApps: number;
    technology: string;
    useCase: string;
    type: string;
}

export interface AppDefinition {
    appName: string;
    overview: string;
    modules: string[];
    pages: string[];
    features: string[];
    functionalRequirements: string[];
    publishedUrl?: string;
    analysisResult?: string;
}

export interface AnalysisResult {
    appName: string;
    expectedPages: string[];
    actualPages: string[];
    missingModules: string[];
    brokenFeatures: string[];
    uiIssues: string[];
    consoleErrors: string[];
    brokenLinks: string[];
    overallStatus: "PASS" | "FAIL" | "PARTIAL";
    screenshotPath?: string;
}

class Config {
    // OpenAI
    readonly openaiApiKey: string;
    readonly openaiModel: string;

    // Rocket.new
    readonly authStatePath: string;
    readonly baseUrl: string;

    // Storage
    readonly csvOutputPath: string;

    // Automation
    readonly maxRetries: number;
    readonly retryDelayMs: number;
    readonly headless: boolean;

    // Paths
    readonly outputDir: string;
    readonly screenshotsDir: string;
    readonly logsDir: string;

    constructor() {
        this.openaiApiKey = this.requireEnv("OPENAI_API_KEY");
        this.openaiModel = process.env.OPENAI_MODEL || "gpt-4o";

        this.authStatePath =
            process.env.AUTH_STATE_PATH ||
            path.resolve(__dirname, "..", "..", "auth", "storageState.json");
        this.baseUrl = process.env.BASE_URL || "https://rocket.new";

        this.csvOutputPath =
            process.env.CSV_OUTPUT_PATH || "./output/app_definitions.csv";

        this.maxRetries = parseInt(process.env.MAX_RETRIES || "3", 10);
        this.retryDelayMs = parseInt(process.env.RETRY_DELAY_MS || "2000", 10);
        this.headless = process.env.HEADLESS === "true";

        // Resolve directories
        const projectRoot = path.resolve(__dirname, "..", "..");
        this.outputDir = path.resolve(projectRoot, "output");
        this.screenshotsDir = path.resolve(projectRoot, "output", "screenshots");
        this.logsDir = path.resolve(projectRoot, "output", "logs");
    }

    private requireEnv(key: string): string {
        const value = process.env[key];
        if (!value) {
            throw new Error(
                `Missing required environment variable: ${key}. ` +
                `Please copy .env.example to .env and fill in the values.`
            );
        }
        return value;
    }
}

export const config = new Config();
