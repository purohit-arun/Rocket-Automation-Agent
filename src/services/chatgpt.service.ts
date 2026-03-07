import OpenAI from "openai";
import { config, AppDefinition, AutomationInput } from "../config/config";
import { createLogger } from "../utils/logger";
import { retryAsync } from "../utils/retry";

const log = createLogger("ChatGPTService");

/**
 * Service wrapping OpenAI API for generating structured app definitions.
 */
export class ChatGPTService {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: config.openaiApiKey,
        });
        log.info("ChatGPT service initialized", { model: config.openaiModel });
    }

    /**
     * Generate multiple app definitions based on user input.
     * Returns structured JSON with app name, overview, modules, pages, features, and requirements.
     */
    async generateAppDefinitions(
        input: AutomationInput
    ): Promise<AppDefinition[]> {
        log.info("Generating app definitions", {
            count: input.numberOfApps,
            technology: input.technology,
            useCase: input.useCase,
            type: input.type,
        });

        const prompt = this.buildPrompt(input);

        const response = await retryAsync(
            async () => {
                const completion = await this.client.chat.completions.create({
                    model: config.openaiModel,
                    messages: [
                        {
                            role: "system",
                            content: `You are an expert application architect. You generate structured application definitions in JSON format. 
Always respond with ONLY valid JSON — no markdown, no code fences, no explanation text.
The JSON must be an array of application definition objects.`,
                        },
                        {
                            role: "user",
                            content: prompt,
                        },
                    ],
                    temperature: 0.7,
                    max_tokens: 4096,
                });

                const content = completion.choices[0]?.message?.content;
                if (!content) {
                    throw new Error("Empty response from ChatGPT");
                }
                return content;
            },
            {
                maxRetries: config.maxRetries,
                delayMs: config.retryDelayMs,
                label: "ChatGPT API Call",
            }
        );

        const definitions = this.parseResponse(response, input.numberOfApps);
        log.info(`Successfully generated ${definitions.length} app definitions`);
        return definitions;
    }

    /**
     * Build the prompt for ChatGPT to generate app definitions.
     */
    private buildPrompt(input: AutomationInput): string {
        return `Generate exactly ${input.numberOfApps} unique application definitions for the following requirements:

- Technology: ${input.technology}
- Use Case: ${input.useCase}
- Application Type: ${input.type}

For each application, provide:
1. appName: A unique, creative application name (keep it concise, 2-4 words)
2. overview: A brief description of the application (2-3 sentences)
3. modules: An array of module names the application should have (5-8 modules)
4. pages: An array of page names the application should have (6-10 pages)
5. features: An array of key features (5-8 features)
6. functionalRequirements: An array of specific functional requirements (5-8 requirements)

Each application must be different and unique while staying within the ${input.type} domain.

Respond with ONLY a valid JSON array of objects with the exact fields listed above. Example structure:
[
  {
    "appName": "Example App Name",
    "overview": "Brief description here.",
    "modules": ["Module1", "Module2"],
    "pages": ["Home", "Dashboard", "Settings"],
    "features": ["Feature1", "Feature2"],
    "functionalRequirements": ["Requirement1", "Requirement2"]
  }
]`;
    }

    /**
     * Parse and validate the ChatGPT response into AppDefinition array.
     */
    private parseResponse(
        response: string,
        expectedCount: number
    ): AppDefinition[] {
        let parsed: unknown;

        // Try to extract JSON from response (handles markdown-wrapped responses)
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        const jsonString = jsonMatch ? jsonMatch[0] : response;

        try {
            parsed = JSON.parse(jsonString);
        } catch (error) {
            log.error("Failed to parse ChatGPT response as JSON", {
                response: response.substring(0, 500),
            });
            throw new Error(
                `Invalid JSON response from ChatGPT: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        if (!Array.isArray(parsed)) {
            throw new Error("ChatGPT response is not an array");
        }

        const definitions: AppDefinition[] = parsed.map(
            (item: Record<string, unknown>, index: number) => {
                this.validateDefinition(item, index);
                return {
                    appName: String(item.appName),
                    overview: String(item.overview),
                    modules: (item.modules as string[]) || [],
                    pages: (item.pages as string[]) || [],
                    features: (item.features as string[]) || [],
                    functionalRequirements:
                        (item.functionalRequirements as string[]) || [],
                };
            }
        );

        if (definitions.length !== expectedCount) {
            log.warn(
                `Expected ${expectedCount} definitions but got ${definitions.length}`
            );
        }

        return definitions;
    }

    /**
     * Validate a single app definition object.
     */
    private validateDefinition(
        item: Record<string, unknown>,
        index: number
    ): void {
        const requiredFields = [
            "appName",
            "overview",
            "modules",
            "pages",
            "features",
            "functionalRequirements",
        ];

        for (const field of requiredFields) {
            if (!(field in item)) {
                throw new Error(
                    `Definition at index ${index} is missing required field: ${field}`
                );
            }
        }
    }
}
