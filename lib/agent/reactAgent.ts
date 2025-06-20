import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { AgentState, ToolNode } from "@langchain/langgraph/prebuilt";
import {
  StateGraph,
  MessagesAnnotation,
  InMemoryStore,
} from "@langchain/langgraph";
import { Connection, MultiServerMCPClient, type ClientConfig } from "@langchain/mcp-adapters";
import { StructuredToolInterface } from "@langchain/core/tools";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentConfiguration } from "@/types/agent";
import { retrieveRelevantDocuments } from "@/lib/retrieval";
import { createClient } from "@/supabase/client";
import { v4 as uuidv4 } from "uuid";
import { getMCPToken } from "@/lib/agent/oauth";
import dotenv from "dotenv";

dotenv.config();

// Initialize the memory store
export const store = new InMemoryStore();

// Function to extract and write user memories
async function writeMemory(state: AgentState, config: RunnableConfig) {
  const configurable =
    (config.configurable as {
      agentId?: string;
      memory?: { enabled: boolean };
    }) || {};
  const userId = configurable.agentId; // Using agentId as userId for now
  const memoryEnabled = configurable.memory?.enabled ?? true; // Default to enabled if not specified

  // Skip memory writing if memory is disabled or no userId
  if (!userId || !memoryEnabled) {
    return { messages: state.messages, has_memory_updates: false };
  }

  // We only analyze the most recent user message
  const userMessage = state.messages.at(-1);
  if (!userMessage || !(userMessage instanceof HumanMessage)) {
    return { messages: state.messages, has_memory_updates: false }; // Not a user message, pass through
  }

  // Get user message content
  const userContent =
    typeof userMessage.content === "string"
      ? userMessage.content
      : JSON.stringify(userMessage.content);

  try {
    // Use the LLM to extract memories from the message
    const memoryExtractor = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0,
    });

    const extractionPrompt = [
      new SystemMessage(
        `You are a memory extraction system. Extract any personal information about the user from this message. 
        Focus on their name, location, preferences, job, likes/dislikes, hobbies, or any other personal details.
        Format your response as a JSON object with the extracted information as key-value pairs.
        If no personal information is found, return an empty JSON object {}.
        For example: {"name": "John", "location": "New York", "likes": ["coffee", "hiking"]}
        Do not include any other text in your response, just the JSON object.`
      ),
      new HumanMessage(userContent),
    ];

    const extraction = await memoryExtractor.invoke(extractionPrompt);
    const extractedData = JSON.parse(extraction.content as string);

    // Only store if there's data extracted
    if (Object.keys(extractedData).length > 0) {
      // Add a message indicating memory is being updated
      const updatedMessages = [
        ...state.messages,
        new AIMessage("Updating memory..."),
      ];

      const namespace = ["user_profile", userId];
      const memoryId = uuidv4();

      // Check if any of the data already exists
      const existingMemories = await store.search(namespace, {
        filter: {},
      });
      const existingData: Record<string, unknown> = {};

      // Build a map of existing attribute types
      existingMemories.forEach((memory) => {
        const { attribute, value } = memory.value as {
          attribute: string;
          value: unknown;
        };
        if (attribute && value) {
          existingData[attribute] = value;
        }
      });

      console.log("Extracted new user data:", extractedData);

      // Store each piece of extracted information as a separate memory
      for (const [key, value] of Object.entries(extractedData)) {
        // Only store if it's new information or different from what we have
        if (
          !existingData[key] ||
          JSON.stringify(existingData[key]) !== JSON.stringify(value)
        ) {
          await store.put(namespace, `${key}_${memoryId}`, {
            attribute: key,
            value: value,
            extracted_at: new Date().toISOString(),
            source_message: userContent,
          });
          console.log(`Stored new memory: ${key} = ${JSON.stringify(value)}`);
        }
      }

      return { messages: updatedMessages, has_memory_updates: true };
    }
  } catch (error) {
    console.error("Error extracting or storing memory:", error);
  }

  // No memory updates
  return { messages: state.messages, has_memory_updates: false };
}

// Function to determine if there's memory to write
function shouldUpdateMemory(state: typeof MessagesAnnotation.State) {
  // Check if the writeMemory function added the has_memory_updates flag
  interface StateWithMemoryFlag {
    messages: Array<BaseMessage>;
    has_memory_updates?: boolean;
  }
  const stateWithMemoryFlag = state as StateWithMemoryFlag;
  return stateWithMemoryFlag.has_memory_updates === true
    ? "agent"
    : "skipMemory";
}

// Function to retrieve user memories
async function retrieveMemories(
  userId: string | undefined,
  memoryEnabled: boolean = true
) {
  if (!userId || !memoryEnabled) {
    return [];
  }

  const namespace = ["user_profile", userId];
  try {
    const memories = await store.search(namespace, { filter: {} });
    return memories;
  } catch (error) {
    console.error("Error retrieving memories:", error);
    return [];
  }
}

export async function retrieveKb(state: AgentState, config: RunnableConfig) {
  const configurable = (config.configurable as { agentId?: string }) || {};
  const { agentId } = configurable;

  let lastUserMsgContent = state.messages.at(-1)?.content ?? "";

  if (Array.isArray(lastUserMsgContent)) {
    lastUserMsgContent = lastUserMsgContent
      .filter(
        (part: unknown): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type: string }).type === "text" &&
          "text" in part &&
          typeof (part as { text: string }).text === "string"
      )
      .map((part: { type: "text"; text: string }) => part.text)
      .join("\n");
  } else if (typeof lastUserMsgContent !== "string") {
    lastUserMsgContent = String(lastUserMsgContent);
  }

  const supabase = await createClient();
  const docs = await retrieveRelevantDocuments(
    lastUserMsgContent,
    supabase,
    6, // topK
    agentId
  );

  return {
    messages: docs.length
      ? [
          {
            type: "system",
            content:
              "You have access to the following information from relevant documents in your knowledge base. Use this information to answer the user's query:\n\n" +
              docs
                .map(
                  (d, i) =>
                    `Source Document Chunk ${i + 1} (from file: ${
                      d.metadata.filename || "unknown"
                    }):\n"""\n${d.pageContent}\n"""`
                )
                .join("\n\n---\n\n") +
              "\n\nBased on the above, and your general knowledge, please respond to the user.",
          },
        ]
      : [],
  };
}

// Function to get enabled MCP servers configuration
interface MCPServerConfig {
  transport: "stdio" | "http"; // Simplified to "http" for both sse and streamable http
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  authProvider?: string;
  automaticSSEFallback?: boolean;
}

// Define MCP servers inline configuration
export const MCP_SERVERS_CONFIG: Record<string, any> = {
  firecrawl: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: {
      FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "",
    },
  },
  "sequential-thinking": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  tavily: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "tavily-mcp@0.1.3"],
    env: {
      TAVILY_API_KEY: process.env.TAVILY_API_KEY || "",
    },
  },
  "canva-dev": {
      "command": "npx",
      "args": [
        "-y",
        "@canva/cli@latest",
        "mcp"
      ]
  },
  
  
  
};

/**
 * Creates the full client configuration object for the MultiServerMCPClient.
 * Renamed from getEnabledMCPServers for clarity.
 */
async function getMcpClientConfig(
  enabledServers: string[],
  userId?: string
): Promise<Record<string, Connection>> {
  console.log("=== getMcpClientConfig Debug ===");
  console.log("Input enabled servers:", enabledServers);
  console.log("Available server configs:", Object.keys(MCP_SERVERS_CONFIG));
  
  const mcpServers: Record<string, Connection> = {};

  for (const serverName of enabledServers) {
    console.log(`Processing server: ${serverName}`);
    
    const serverConfig = MCP_SERVERS_CONFIG[serverName];
    if (!serverConfig) {
      console.warn(
        `❌ Server "${serverName}" not found in configuration. Skipping.`
      );
      continue;
    }

    console.log(`✅ Found config for ${serverName}:`, serverConfig);

    const processedConfig: any = { ...serverConfig };

    // Process environment variables and OAuth tokens in headers
    if (processedConfig.headers) {
      console.log(`Processing headers for ${serverName}:`, processedConfig.headers);
      const processedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(processedConfig.headers)) {
        let processedValue = value as string;

        // Handle OAuth token placeholders
        if (typeof value === 'string' && value.startsWith("OAUTH:") && userId) {
          const provider = value.replace("OAUTH:", "");
          console.log(`Fetching OAuth token for provider: ${provider}`);
          const token = await getMCPToken(userId, provider);
          if (token) {
            processedValue = `Bearer ${token}`; // It's good practice to include "Bearer"
            console.log(`✅ OAuth token found for ${provider}`);
          } else {
            console.warn(`❌ OAuth token for provider "${provider}" not found.`);
          }
        }
        processedHeaders[key] = processedValue;
      }
      processedConfig.headers = processedHeaders;
      console.log(`Processed headers for ${serverName}:`, processedHeaders);
    }
    
    // Process environment variables
    if (processedConfig.env) {
      console.log(`Processing env vars for ${serverName}:`, processedConfig.env);
      const processedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(processedConfig.env)) {
        processedEnv[key] = value as string;
      }
      processedConfig.env = processedEnv;
    }
    
    mcpServers[serverName] = processedConfig as Connection;
    console.log(`✅ Added server ${serverName} to config`);
  }

  // NOTE: MultiServerMCPClient constructor expects servers directly, not wrapped in mcpServers
  // We'll pass the servers object directly to the constructor instead of using ClientConfig
  
  console.log("Final mcpServers count:", Object.keys(mcpServers).length);
  console.log("Final mcpServers:", Object.keys(mcpServers));

  return mcpServers;
}

/**
 * Initializes the MCP client and fetches tools for the enabled servers.
 */
async function initializeMCPClient(
  enabledServers: string[],
  userId?: string
): Promise<StructuredToolInterface[]> {
  console.log("=== initializeMCPClient Debug ===");
  console.log("Enabled servers:", enabledServers);
  console.log("User ID:", userId);

  // 1. Get the correctly formatted config object.
  const mcpServers = await getMcpClientConfig(enabledServers, userId);

  if (Object.keys(mcpServers).length === 0) {
    console.log("No enabled MCP servers, returning empty tools list.");
    return [];
  }

  console.log(
    "Initializing MCP client with servers:",
    Object.keys(mcpServers)
  );
  console.log("MCP Servers Config:", JSON.stringify(mcpServers, null, 2));

  try {
    // 2. Pass the servers object DIRECTLY to the constructor.
    const mcpClient = new MultiServerMCPClient(mcpServers);
    console.log("✅ MCP Client created successfully");

    // 3. Initialize connections first to ensure servers are ready
    console.log("Initializing connections...");
    const serverTools = await mcpClient.initializeConnections();
    console.log("Connection results:", Object.keys(serverTools));

    // 4. Get the tools from the MCP client.
    console.log("Fetching tools from MCP client...");
    const tools = await mcpClient.getTools();
    console.log("✅ Tools fetched successfully:", tools.length, "tools");
    
    // Log each tool for debugging
    tools.forEach((tool, index) => {
      console.log(`Tool ${index + 1}:`, {
        name: tool.name,
        description: tool.description,
        schema: tool.schema
      });
    });
    
    // Optional: You might want to hold onto the client instance to close it later
    // For example, by attaching it to the graph's state or a global manager.
    // await mcpClient.close();
    
    return tools;
  } catch (error) {
    console.error("❌ Failed to initialize MCP Client or get tools:", error);
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    // Return empty array or re-throw, depending on desired behavior
    return [];
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to find information`;

// Cache for tools based on enabled MCP server configuration
const toolCache = new Map<string, StructuredToolInterface[]>();

// Initialize an empty tool node; tools will be populated per run
const toolNode = new ToolNode([]);

// Base model factory function; tools will be bound dynamically
function createBaseModel() {
  return new ChatOpenAI({
    model: "gpt-4.1",
    temperature: 0.5,
  });
}

// Define the function that determines whether to continue or not
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  console.log("=== shouldContinue Debug ===");
  console.log("Last message type:", lastMessage.constructor.name);
  console.log("Has tool_calls?", !!(lastMessage.tool_calls?.length));
  console.log("Tool calls count:", lastMessage.tool_calls?.length || 0);
  
  if (lastMessage.tool_calls?.length) {
    console.log("Tool calls details:", lastMessage.tool_calls);
  }

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    console.log("🔧 Routing to tools node");
    return "tools";
  }
  console.log("🛑 Ending conversation");
  return "__end__";
}

// Define the function that calls the model
async function callModel(
  state: typeof MessagesAnnotation.State,
  config: RunnableConfig
) {
  const store = (config as any).store;
  if (!store) {
    throw new Error("store is required when compiling the graph");
  }
  if (!config.configurable?.agentId) {
    throw new Error("agentId is required in the config");
  }
  
  console.log("=== Full config.configurable Debug ===");
  console.log("config.configurable:", JSON.stringify(config.configurable, null, 2));
  
  const agentConfig = config.configurable as AgentConfiguration;
  const userId = (config.configurable as { agentId?: string })?.agentId;
  const systemPrompt = agentConfig.prompt_template || DEFAULT_SYSTEM_PROMPT;
  const memoryEnabled = agentConfig.memory?.enabled ?? true; // Default to enabled if not specified

  console.log("Agent config enabled servers:", agentConfig.enabled_mcp_servers);

  // Retrieve user memories
  const memories = await retrieveMemories(userId, memoryEnabled);

  // Format memories for inclusion in the prompt
  let memoryContext = "";
  if (memories.length > 0 && memoryEnabled) {
    memoryContext = "\n\nUser Profile Information:\n";
    const profileData: Record<string, unknown> = {};

    // Group memories by attribute
    memories.forEach((memory) => {
      const { attribute, value } = memory.value as {
        attribute: string;
        value: unknown;
      };
      if (attribute && value) {
        profileData[attribute] = value;
      }
    });

    // Format as bullet points
    for (const [attribute, value] of Object.entries(profileData)) {
      if (Array.isArray(value)) {
        memoryContext += `- ${attribute}: ${value.join(", ")}\n`;
      } else {
        memoryContext += `- ${attribute}: ${value}\n`;
      }
    }
  }

  // Get dynamic tool information for the current enabled servers
  const availableToolsInfo = getAvailableMCPServersInfo();
  const enabledToolsList = (agentConfig.enabled_mcp_servers || [])
    .map(server => `- ${server}: ${availableToolsInfo[server] || "Tool available"}`)
    .join("\n");
  
  const toolsContext = enabledToolsList ? `\n\n## Available Tools\nYou have access to the following tools:\n${enabledToolsList}\n\nUse these tools when appropriate to help answer user questions. Always consider if a tool can provide more accurate or up-to-date information than your training data.` : "";

  // Combine system prompt with memory context and tools context
  const enhancedSystemPrompt = `${systemPrompt}${memoryContext}${toolsContext}`;

  // Filter out "memory" as it's handled by the in-memory store, not MCP
  const enabledServers = (agentConfig.enabled_mcp_servers || []).filter(
    server => server !== "memory"
  );
  console.log("Filtered enabled servers (excluding memory):", enabledServers);
  
  const cacheKey = `${enabledServers.slice().sort().join(",")}-${userId}`;
  let tools = toolCache.get(cacheKey);
  if (!tools) {
    console.log("Tools not in cache, initializing MCP client...");
    tools = await initializeMCPClient(enabledServers, userId);
    toolCache.set(cacheKey, tools);
  } else {
    console.log("Using cached tools");
  }

  console.log("=== Tools being bound to model ===");
  console.log("Number of tools:", tools.length);
  tools.forEach((tool, index) => {
    console.log(`Tool ${index + 1}:`, {
      name: tool.name,
      description: tool.description
    });
  });

  toolNode.tools = tools;
  const baseModel = createBaseModel();
  const modelWithTools = baseModel.bindTools(tools);

  console.log("=== Enhanced System Prompt ===");
  console.log(enhancedSystemPrompt);
  console.log("=== End Prompt ===");

  const response = await modelWithTools.invoke([
    new SystemMessage(enhancedSystemPrompt),
    ...state.messages,
  ]);

  console.log("=== Model Response Debug ===");
  console.log("Response type:", typeof response);
  console.log("Has tool_calls?", !!(response as AIMessage).tool_calls?.length);
  if ((response as AIMessage).tool_calls?.length) {
    console.log("Tool calls:", (response as AIMessage).tool_calls);
  }
  console.log("Response content preview:", (response.content as string).substring(0, 200));

  return { messages: [response] };
}

// Define and export the graph for LangGraph Platform
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("retrieveKb", retrieveKb)
  .addNode("writeMemory", writeMemory)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addNode("skipMemory", (state) => state) // Pass-through node that does nothing

  // Flow from start to Knowledge Base retrieval
  .addEdge("__start__", "retrieveKb")

  // Knowledge Base to memory analysis
  .addEdge("retrieveKb", "writeMemory")

  // Conditional path from writeMemory based on whether there's memory to update
  .addConditionalEdges("writeMemory", shouldUpdateMemory)

  // Both memory paths eventually reach agent
  .addEdge("skipMemory", "agent")

  // Tool usage cycles back to agent
  .addEdge("tools", "agent")

  // Conditional path from agent based on whether additionaltools are needed
  .addConditionalEdges("agent", shouldContinue);

// Export the compiled graph for platform deployment
export const graph = workflow.compile();

// Get available MCP servers description for prompt generation
export function getAvailableMCPServersInfo(): Record<string, string> {
  return {
    "gmail-mcp-server": "Access and manage Gmail messages, send emails, search and organize your inbox",
    "firecrawl": "Web scraping and content extraction from websites, crawl and extract structured data",
    "memory": "Knowledge graph management for creating entities, relations, and observations",
    "tavily": "Web search and real-time information retrieval from the internet"
  };
}

// Get tools info for specific enabled servers
export async function getToolsInfoForServers(enabledServers: string[], userId?: string): Promise<string[]> {
  const tools = await initializeMCPClient(enabledServers.filter(s => s !== "memory"), userId);
  const toolDescriptions = tools.map(tool => `- ${tool.name}: ${tool.description}`);
  
  // Add memory tool if enabled
  if (enabledServers.includes("memory")) {
    toolDescriptions.push("- memory: Store and retrieve user profile information and conversation context");
  }
  
  return toolDescriptions;
}

// Simple test function for debugging MCP configuration
export async function testMCPConfiguration(enabledServers: string[], userId?: string) {
  console.log("=== Testing MCP Configuration ===");
  console.log("Testing servers:", enabledServers);
  console.log("User ID:", userId);
  
  try {
    const tools = await initializeMCPClient(enabledServers, userId);
    console.log("✅ Successfully loaded", tools.length, "tools");
    tools.forEach((tool, index) => {
      console.log(`  ${index + 1}. ${tool.name}: ${tool.description}`);
    });
    return tools;
  } catch (error) {
    console.error("❌ Failed to load MCP tools:", error);
    return [];
  }
}

