import { AutomationInput, AppDefinition } from "../config/config";
import { ChatGPTService } from "../services/chatgpt.service";
import { CSVStorageService } from "../services/csvStorage.service";
import { createLogger } from "../utils/logger";

const log = createLogger("AppDefinitionAgent");

/**
 * Agent responsible for Step 1 + Step 2:
 *  - Generate app definitions using ChatGPT
 *  - Store them in local CSV
 */
export class AppDefinitionAgent {
    private chatgptService: ChatGPTService;
    private csvService: CSVStorageService;

    constructor(csvService: CSVStorageService) {
        this.chatgptService = new ChatGPTService();
        this.csvService = csvService;
    }

    /**
     * Generate app definitions and store them.
     * @returns The generated app definitions.
     */
    async execute(input: AutomationInput): Promise<AppDefinition[]> {
        log.info("═══════════════════════════════════════════════════════════");
        log.info("STEP 1 & 2: Generating App Definitions and Storing");
        log.info("═══════════════════════════════════════════════════════════");
        log.info("Input configuration", {
            numberOfApps: input.numberOfApps,
            technology: input.technology,
            useCase: input.useCase,
            type: input.type,
        });

        // Step 1: Generate definitions via ChatGPT
        log.info("Calling ChatGPT to generate app definitions...");
        const definitions = await this.chatgptService.generateAppDefinitions(input);

        log.info(`Generated ${definitions.length} app definitions:`);
        definitions.forEach((def, i) => {
            log.info(`  [${i + 1}] ${def.appName} — ${def.pages.length} pages, ${def.modules.length} modules`);
        });

        // Step 2: Store in CSV
        log.info("Storing definitions to CSV...");
        await this.csvService.writeAppDefinitions(definitions);

        log.info(
            `App definitions generated and stored successfully. CSV: ${this.csvService.getFilePath()}`
        );

        return definitions;
    }
}
