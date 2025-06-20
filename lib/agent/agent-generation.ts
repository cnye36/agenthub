import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { generateAgentAvatar } from "@/lib/avatar-generation";
import { getAvailableMCPServersInfo, MCP_SERVERS_CONFIG } from "@/lib/agent/reactAgent";
import type { AgentConfiguration, ModelType } from "@/types/agent";

// Store previously generated names per user with a maximum cache size
const MAX_USERS_IN_CACHE = 1000; // Maximum number of users to store in cache
const MAX_NAMES_PER_USER = 50; // Maximum number of names to store per user

// Simple LRU cache for storing agent names per user
class UserNamesCache {
  private cache: Map<string, string[]> = new Map();
  private userQueue: string[] = []; // Track user access order for LRU

  add(userId: string, name: string): void {
    // Update user position in the queue (most recently used)
    this.updateUserPosition(userId);

    // Get or initialize the user's name list
    const names = this.cache.get(userId) || [];

    // Add the new name if it doesn't already exist
    if (!names.includes(name)) {
      names.push(name);

      // Limit the number of names per user
      if (names.length > MAX_NAMES_PER_USER) {
        names.shift(); // Remove oldest name
      }
    }

    // Update the cache
    this.cache.set(userId, names);
  }

  get(userId: string): string[] {
    this.updateUserPosition(userId);
    return this.cache.get(userId) || [];
  }

  private updateUserPosition(userId: string): void {
    // Remove user from current position
    const index = this.userQueue.indexOf(userId);
    if (index !== -1) {
      this.userQueue.splice(index, 1);
    }

    // Add user to the end (most recently used)
    this.userQueue.push(userId);

    // Evict least recently used user if cache is full
    if (this.userQueue.length > MAX_USERS_IN_CACHE) {
      const lruUser = this.userQueue.shift();
      if (lruUser) {
        this.cache.delete(lruUser);
      }
    }
  }
}

const userGeneratedNames = new UserNamesCache();

const nameGeneratorPrompt = PromptTemplate.fromTemplate(`
Generate a creative, memorable, and unique name for an AI agent based on the following description and type.
The name should be professional yet engaging, distinctive, and futuristic-sounding.

Agent Type: {agentType}
Description: {description}
Previously Generated Names: {previousNames}

Approach options (choose one that best fits):
1. Clever wordplay related to the agent's function (e.g., "Nexus Knowledge" for research)
2. Human-name combination (e.g., "Insight Irene", "Research Robby", "Viral Vickie")
3. Abstract concept + functional term (e.g., "Prism Analytics", "Quantum Scribe")
4. Mythological or historical reference related to the function (e.g., "Apollo Scholar", "Hermes Connect")
5. Short, punchy single word with depth (e.g., "Cipher", "Pulse", "Nexus")

Requirements:
- Name should be 1-3 words (can include a human first name as one of the words)
- Must be memorable, unique, and NOT similar to any of the previously generated names
- Should clearly reflect the agent's primary purpose
- Professional enough for business use
- Should NOT include the words "AI", "Bot", or "Assistant"
- Should feel distinct and personalized

CREATE A NAME THAT IS COMPLETELY DIFFERENT FROM ANY PREVIOUSLY GENERATED NAMES.

Return only the name, nothing else.
`);

const configurationPrompt = PromptTemplate.fromTemplate(`
Create a comprehensive configuration for an AI agent based on the following description.
Focus on making the agent highly effective at its specific task while maintaining appropriate constraints.

User's Description: {description}
Agent Type: {agentType}

Available Tools:
${Object.entries(getAvailableMCPServersInfo())
  .map(([name, description]) => `- ${name}: ${description}`)
  .join("\n")}



Provide the following information in a clear format:

1. NAME: Create a creative name for the agent (1-3 words, no AI/Bot/Assistant)
2. DESCRIPTION: Write a concise summary of the agent's capabilities
3. INSTRUCTIONS: Create a detailed and structured system prompt that follows this format:
   
   ## Identity
   [Define who the agent is and its primary role]
   
   ## Scope
   - [List what tasks/topics the agent should focus on]
   - [List what the agent should NOT handle]
   - [Define escalation path for out-of-scope requests]
   
   ## Responsibility
   - [How the agent should manage interactions]
   - [Key tasks the agent should perform]
   - [How to handle edge cases]
   
   ## Response Style
   - [Tone and communication style]
   - [Format preferences]
   - [Any specific language patterns to use or avoid]
   
   ## Ability
   - [What capabilities the agent has - describe capabilities generically, not specific tool names]
   - [When to use tools for tasks like email, web search, knowledge management, etc.]
   - [Note: Available tools will be dynamically provided at runtime based on configuration]
   
   ## Guardrails
   - [Privacy considerations]
   - [Accuracy requirements]
   - [Ethical guidelines]
   
   ## Instructions
   - [Specific operational instructions with examples where helpful]
   - [Handling edge cases]
   - [Closing interactions]

4. TOOLS: List required tools from: ${Object.keys(getAvailableMCPServersInfo()).join(
  ", "
)}
5. MODEL: Specify gpt-4.1
6. TEMPERATURE: Provide a number between 0 and 1
7. MEMORY_WINDOW: Suggest number of past messages to consider (default: 10)
8. MEMORY_RELEVANCE: Suggest relevance threshold between 0-1 for memory retrieval (default: 0.7)

Format each response on a new line with the label, followed by a colon and the value.
Do not include any placeholders like [COMPANY NAME] or [PRODUCT] in the instructions - the user will add specific details later.
The instructions should be comprehensive and specific to the agent type without requiring further customization.
Do not include any additional formatting or explanation.
`);

export async function generateAgentName(
  description: string,
  agentType: string,
  ownerId: string
): Promise<string> {
  const model = new ChatOpenAI({
    modelName: "gpt-4o",
    temperature: 1.0,
  });

  // Get previously generated names for this user
  const previousNames = userGeneratedNames.get(ownerId).join(", ");

  const formattedPrompt = await nameGeneratorPrompt.format({
    description,
    agentType,
    previousNames: previousNames || "None yet",
  });

  const response = await model.invoke(formattedPrompt);
  const generatedName = response.content.toString().trim();

  // Store the new name in the user's cache
  userGeneratedNames.add(ownerId, generatedName);

  return generatedName;
}

export interface GeneratedConfig {
  owner_id: string;
  name: string;
  description: string;
  agent_avatar: string;
  agent_type: string;
  config: AgentConfiguration;
  metadata: Record<string, unknown>;
}

export async function generateAgentConfiguration(
  description: string,
  agentType: string,
  ownerId: string
): Promise<GeneratedConfig> {
  const model = new ChatOpenAI({
    modelName: "gpt-4o",
    temperature: 0.7,
  });

  const formattedPrompt = await configurationPrompt.format({
    description,
    agentType,
    ownerId,
  });

  const response = await model.invoke(formattedPrompt);
  const responseText = response.content.toString();

  // Parse the response into structured data
  const lines = responseText.split("\n").filter((line) => line.trim());

  // Initialize the configuration with default values
  const config: GeneratedConfig = {
    owner_id: ownerId,
    name: "",
    description: "",
    agent_avatar: "/images/default-avatar.png", // Will be updated after name generation
    agent_type: agentType,
    config: {
      model: "gpt-4.1",
      temperature: 0.7,
      tools: [],
      memory: {
        enabled: true,
        max_entries: 10,
        relevance_threshold: 0.7,
      },
      prompt_template: "",
      knowledge_base: {
        isEnabled: false,
        config: {
          sources: [],
        },
      },
      enabled_mcp_servers: ["memory"], // Memory server is always enabled
      agentId: ownerId, // Store the agentId directly in the config
    },
    metadata: {},
  };

  // Parse the response and collect instructions
  let instructionsContent = "";
  let isCollectingInstructions = false;

  for (const line of lines) {
    if (line.startsWith("INSTRUCTIONS:")) {
      isCollectingInstructions = true;
      continue;
    }

    if (isCollectingInstructions) {
      if (
        line.startsWith("TOOLS:") ||
        line.startsWith("MODEL:") ||
        line.startsWith("TEMPERATURE:") ||
        line.startsWith("MEMORY_WINDOW:") ||
        line.startsWith("MEMORY_RELEVANCE:")
      ) {
        isCollectingInstructions = false;
        config.config.prompt_template = instructionsContent.trim();
      } else {
        instructionsContent += line + "\n";
        continue;
      }
    }

    // Regular processing for non-instruction sections
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();

    if (!key || !value) continue;

    switch (key.trim().toUpperCase()) {
      case "NAME":
        config.name = value;
        break;
      case "DESCRIPTION":
        config.description = value;
        break;
      case "TOOLS":
        // Parse requested MCP servers
        const requestedServers = value.split(",").map((t) => t.trim());
        config.config.enabled_mcp_servers = requestedServers.filter(
          (server) =>
            Object.prototype.hasOwnProperty.call(
              MCP_SERVERS_CONFIG,
              server
            ) || server === "memory"
        );
        break;
      case "MODEL":
        config.config.model = value as ModelType;
        break;
      case "TEMPERATURE":
        config.config.temperature = parseFloat(value);
        break;
      case "MEMORY_WINDOW":
        config.config.memory.max_entries = parseInt(value, 10);
        break;
      case "MEMORY_RELEVANCE":
        config.config.memory.relevance_threshold = parseFloat(value);
        break;
    }
  }

  // Ensure required fields are present
  if (!config.name || !config.config.prompt_template || !config.description) {
    throw new Error("Missing required fields in agent configuration");
  }

  try {
    // Generate avatar and wait for the result instead of doing it asynchronously
    const avatarPath = await generateAgentAvatar(
      config.name,
      config.agent_type
    );
    config.agent_avatar = avatarPath;
  } catch (error) {
    console.error("Failed to generate avatar:", error);
    // Keep the default avatar
  }

  return config;
}
