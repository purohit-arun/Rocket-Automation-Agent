import { AutomationInput, AppDefinition, AnalysisResult } from "../config/config";
import { CSVStorageService } from "../services/csvStorage.service";
import { AppDefinitionAgent } from "../agents/appDefinition.agent";
import { RocketBuilderAgent } from "../agents/rocketBuilder.agent";
import { AnalysisAgent } from "../agents/analysis.agent";
import { createLogger } from "../utils/logger";

const log = createLogger("AutomationRunner");

/**
 * End-to-end orchestrator for the Rocket.new automation pipeline.
 *
 * Pipeline:
 *  1. Generate app definitions (ChatGPT)
 *  2. Store definitions (CSV)
 *  3. Build & publish apps on Rocket.new (Playwright)
 *  4. Analyze published apps
 *  5. Generate comparison report
 */
export class AutomationRunner {
    private csvService: CSVStorageService;
    private definitionAgent: AppDefinitionAgent;
    private builderAgent: RocketBuilderAgent;
    private analysisAgent: AnalysisAgent;

    constructor() {
        this.csvService = new CSVStorageService();
        this.definitionAgent = new AppDefinitionAgent(this.csvService);
        this.builderAgent = new RocketBuilderAgent(this.csvService);
        this.analysisAgent = new AnalysisAgent(this.csvService);
    }

    /**
     * Run the complete automation pipeline.
     */
    async run(input: AutomationInput): Promise<{
        definitions: AppDefinition[];
        analysisResults: AnalysisResult[];
    }> {
        log.info("╔═══════════════════════════════════════════════════════════╗");
        log.info("║        ROCKET.NEW AUTOMATION AGENT — STARTING           ║");
        log.info("╚═══════════════════════════════════════════════════════════╝");
        log.info("Input:", {
            numberOfApps: input.numberOfApps,
            technology: input.technology,
            useCase: input.useCase,
            type: input.type,
        });

        const startTime = Date.now();

        // ─── PHASE 1 & 2: Generate definitions + Store ─────────────────────
        log.info("\n🔧 PHASE 1 & 2: Generating and storing app definitions...\n");
        const definitions = await this.definitionAgent.execute(input);

        // ─── PHASE 3: Build & Publish on Rocket.new ────────────────────────
        log.info("\n🚀 PHASE 3: Building and publishing apps on Rocket.new...\n");
        const updatedDefinitions = await this.builderAgent.execute();

        // ─── PHASE 4 & 5: Analyze + Report ─────────────────────────────────
        log.info("\n🔍 PHASE 4 & 5: Analyzing published applications...\n");
        const analysisResults = await this.analysisAgent.execute();

        // ─── SUMMARY ───────────────────────────────────────────────────────
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        log.info("╔═══════════════════════════════════════════════════════════╗");
        log.info("║        ROCKET.NEW AUTOMATION — COMPLETE                 ║");
        log.info("╚═══════════════════════════════════════════════════════════╝");
        log.info(`Total time: ${elapsed} minutes`);
        log.info(`Apps generated: ${definitions.length}`);
        log.info(`Apps published: ${updatedDefinitions.filter((d) => d.publishedUrl).length}`);
        log.info(`Apps analyzed: ${analysisResults.length}`);
        log.info(`CSV output: ${this.csvService.getFilePath()}`);

        return {
            definitions: updatedDefinitions,
            analysisResults,
        };
    }

    /**
     * Run only the definition generation step (Step 1 & 2).
     * Useful for testing or when Rocket.new is unavailable.
     */
    async runDefinitionOnly(input: AutomationInput): Promise<AppDefinition[]> {
        log.info("Running definition generation only...");
        return this.definitionAgent.execute(input);
    }

    /**
     * Run only the build step (Step 3).
     * Requires definitions to already be in CSV.
     */
    async runBuildOnly(): Promise<AppDefinition[]> {
        log.info("Running Rocket.new build only...");
        return this.builderAgent.execute();
    }

    /**
     * Run only the analysis step (Step 4 & 5).
     * Requires published URLs to already be in CSV.
     */
    async runAnalysisOnly(): Promise<AnalysisResult[]> {
        log.info("Running analysis only...");
        return this.analysisAgent.execute();
    }
}
