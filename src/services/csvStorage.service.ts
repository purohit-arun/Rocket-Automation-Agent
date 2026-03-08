import fs from "fs";
import path from "path";
import { AppDefinition, AnalysisResult } from "../config/config";
import { createLogger } from "../utils/logger";

const log = createLogger("CSVStorage");

/**
 * Delimiter for array fields within CSV columns.
 */
const ARRAY_DELIMITER = " | ";

/**
 * CSV Storage Service — local CSV file storage instead of Google Sheets.
 * Manages reading/writing app definitions and analysis results.
 */
export class CSVStorageService {
    private filePath: string;
    private headers: string[];

    constructor(csvPath?: string) {
        this.filePath = csvPath || path.resolve(process.cwd(), "output", "app_definitions.csv");
        this.headers = [
            "App Name",
            "Overview",
            "Modules",
            "Pages",
            "Features",
            "Functional Requirements",
            "Published URL",
            "Analysis Result",
        ];

        this.ensureDirectoryExists();
        log.info(`CSV Storage initialized at: ${this.filePath}`);
    }

    /**
     * Ensure the output directory exists, create if not.
     */
    private ensureDirectoryExists(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log.debug(`Created output directory: ${dir}`);
        }
    }

    /**
     * Escape a CSV field — wraps in quotes if it contains commas, quotes, or newlines.
     */
    private escapeCSVField(field: string): string {
        if (
            field.includes(",") ||
            field.includes('"') ||
            field.includes("\n") ||
            field.includes("\r")
        ) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    }

    /**
     * Parse a CSV line respecting quoted fields.
     */
    private parseCSVLine(line: string): string[] {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (inQuotes) {
                if (char === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        current += '"';
                        i++; // skip escaped quote
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += char;
                }
            } else {
                if (char === '"') {
                    inQuotes = true;
                } else if (char === ",") {
                    fields.push(current.trim());
                    current = "";
                } else {
                    current += char;
                }
            }
        }
        fields.push(current.trim());
        return fields;
    }

    /**
     * Write app definitions to CSV file.
     * Creates or overwrites the CSV file with header row + data rows.
     */
    async writeAppDefinitions(definitions: AppDefinition[]): Promise<void> {
        log.info(`Writing ${definitions.length} app definitions to CSV`);

        const rows: string[] = [this.headers.join(",")];

        for (const def of definitions) {
            const row = [
                this.escapeCSVField(def.appName),
                this.escapeCSVField(def.overview),
                this.escapeCSVField(def.modules.join(ARRAY_DELIMITER)),
                this.escapeCSVField(def.pages.join(ARRAY_DELIMITER)),
                this.escapeCSVField(def.features.join(ARRAY_DELIMITER)),
                this.escapeCSVField(def.functionalRequirements.join(ARRAY_DELIMITER)),
                this.escapeCSVField(def.publishedUrl || ""),
                this.escapeCSVField(def.analysisResult || ""),
            ];
            rows.push(row.join(","));
        }

        fs.writeFileSync(this.filePath, rows.join("\n"), "utf-8");
        log.info(`CSV written successfully: ${this.filePath}`);
    }

    /**
     * Read all app definitions from CSV.
     */
    async readAppDefinitions(): Promise<AppDefinition[]> {
        if (!fs.existsSync(this.filePath)) {
            log.warn(`CSV file not found: ${this.filePath}`);
            return [];
        }

        const content = fs.readFileSync(this.filePath, "utf-8");
        const lines = content.split("\n").filter((line) => line.trim() !== "");

        if (lines.length <= 1) {
            log.warn("CSV file has no data rows");
            return [];
        }

        const definitions: AppDefinition[] = [];

        // Skip header (line 0)
        for (let i = 1; i < lines.length; i++) {
            const fields = this.parseCSVLine(lines[i]);
            if (fields.length < 6) {
                log.warn(`Skipping malformed CSV row ${i + 1}: insufficient columns`);
                continue;
            }

            definitions.push({
                appName: fields[0] || "",
                overview: fields[1] || "",
                modules: fields[2] ? fields[2].split(ARRAY_DELIMITER).map((s) => s.trim()) : [],
                pages: fields[3] ? fields[3].split(ARRAY_DELIMITER).map((s) => s.trim()) : [],
                features: fields[4] ? fields[4].split(ARRAY_DELIMITER).map((s) => s.trim()) : [],
                functionalRequirements: fields[5]
                    ? fields[5].split(ARRAY_DELIMITER).map((s) => s.trim())
                    : [],
                publishedUrl: fields[6] || undefined,
                analysisResult: fields[7] || undefined,
            });
        }

        log.info(`Read ${definitions.length} app definitions from CSV`);
        return definitions;
    }

    /**
     * Update the published URL for a specific app (by name).
     */
    async updatePublishedUrl(
        appName: string,
        publishedUrl: string
    ): Promise<void> {
        log.info(`Updating published URL for "${appName}": ${publishedUrl}`);

        const definitions = await this.readAppDefinitions();
        const index = definitions.findIndex((d) => d.appName === appName);

        if (index === -1) {
            log.error(`App "${appName}" not found in CSV`);
            throw new Error(`App "${appName}" not found in CSV`);
        }

        definitions[index].publishedUrl = publishedUrl;
        await this.writeAppDefinitions(definitions);
        log.info(`Published URL updated for "${appName}"`);
    }

    /**
     * Update the analysis result string for a specific app (by name).
     * Writes a human-readable FOUND/MISSING summary to the "Analysis Result" column.
     */
    async updateAnalysisResult(
        appName: string,
        result: string
    ): Promise<void> {
        log.info(`Updating analysis result for "${appName}"`);

        const definitions = await this.readAppDefinitions();
        const index = definitions.findIndex((d) => d.appName === appName);

        if (index === -1) {
            log.error(`App "${appName}" not found in CSV`);
            throw new Error(`App "${appName}" not found in CSV`);
        }

        definitions[index].analysisResult = result;
        await this.writeAppDefinitions(definitions);
        log.info(`Analysis result updated for "${appName}"`);
    }

    /**
     * Write analysis results back to the CSV by updating the analysis column.
     */
    async writeAnalysisResults(results: AnalysisResult[]): Promise<void> {
        log.info(`Writing analysis results for ${results.length} apps`);

        const definitions = await this.readAppDefinitions();

        for (const result of results) {
            const index = definitions.findIndex((d) => d.appName === result.appName);
            if (index !== -1) {
                definitions[index].analysisResult = JSON.stringify({
                    overallStatus: result.overallStatus,
                    expectedPages: result.expectedPages,
                    actualPages: result.actualPages,
                    missingModules: result.missingModules,
                    brokenFeatures: result.brokenFeatures,
                    uiIssues: result.uiIssues,
                    consoleErrors: result.consoleErrors,
                    brokenLinks: result.brokenLinks,
                });
            } else {
                log.warn(`App "${result.appName}" not found in CSV for analysis update`);
            }
        }

        await this.writeAppDefinitions(definitions);
        log.info("Analysis results written to CSV successfully");
    }

    /**
     * Generate a detailed human-readable analysis report and save as a separate CSV.
     */
    async writeAnalysisReport(results: AnalysisResult[]): Promise<string> {
        const reportPath = this.filePath.replace(".csv", "_analysis_report.csv");
        log.info(`Generating analysis report: ${reportPath}`);

        const reportHeaders = [
            "App Name",
            "Overall Status",
            "Expected Pages",
            "Actual Pages",
            "Missing Modules",
            "Broken Features",
            "UI Issues",
            "Console Errors",
            "Broken Links",
            "Screenshot",
        ];

        const rows: string[] = [reportHeaders.join(",")];

        for (const result of results) {
            const row = [
                this.escapeCSVField(result.appName),
                result.overallStatus,
                this.escapeCSVField(result.expectedPages.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.actualPages.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.missingModules.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.brokenFeatures.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.uiIssues.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.consoleErrors.join(ARRAY_DELIMITER)),
                this.escapeCSVField(result.brokenLinks.join(ARRAY_DELIMITER)),
                result.screenshotPath || "",
            ];
            rows.push(row.join(","));
        }

        fs.writeFileSync(reportPath, rows.join("\n"), "utf-8");
        log.info(`Analysis report written: ${reportPath}`);
        return reportPath;
    }

    /**
     * Get the file path of the current CSV.
     */
    getFilePath(): string {
        return this.filePath;
    }
}
