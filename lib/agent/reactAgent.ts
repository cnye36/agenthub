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
const MCP_SERVERS_CONFIG: Record<string, any> = {
  "gmail-mcp-server": {
    transport: "http",
    url: "http://146.190.159.62:8080/mcp",
    headers: {
      "x-google-access-token": "OAUTH:google",
    },
    authProvider: "google",
    automaticSSEFallback: true,
  },
  firecrawl: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: {
      FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "",
    },
  },
  math: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-math"],
  },
};

/**
 * Creates the full client configuration object for the MultiServerMCPClient.
 * Renamed from getEnabledMCPServers for clarity.
 */
async function getMcpClientConfig(
  enabledServers: string[],
  userId?: string
): Promise<ClientConfig> {
  const mcpServers: Record<string, Connection> = {};

  for (const serverName of enabledServers) {
    const serverConfig = MCP_SERVERS_CONFIG[serverName];
    if (!serverConfig) {
      console.warn(
        `Server "${serverName}" not found in configuration. Skipping.`
      );
      continue;
    }

    const processedConfig: any = { ...serverConfig };

    // Process environment variables and OAuth tokens in headers
    if (processedConfig.headers) {
      const processedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(processedConfig.headers)) {
        let processedValue = value as string;

        // Handle OAuth token placeholders
        if (typeof value === 'string' && value.startsWith("OAUTH:") && userId) {
          const provider = value.replace("OAUTH:", "");
          const token = await getMCPToken(userId, provider);
          if (token) {
            processedValue = `Bearer ${token}`; // It's good practice to include "Bearer"
          } else {
            console.warn(`OAuth token for provider "${provider}" not found.`);
          }
        }
        processedHeaders[key] = processedValue;
      }
      processedConfig.headers = processedHeaders;
    }
    mcpServers[serverName] = processedConfig as Connection;
  }

  // Construct the final ClientConfig object
  const clientConfig: ClientConfig = {
    mcpServers,
    useStandardContentBlocks: true,
    throwOnLoadError: false, // It's often better to not throw on load error in production
  };

  return clientConfig;
}

/**
 * Initializes the MCP client and fetches tools for the enabled servers.
 */
async function initializeMCPClient(
  enabledServers: string[],
  userId?: string
): Promise<StructuredToolInterface[]> {
  // 1. Get the correctly formatted config object.
  const mcpConfig = await getMcpClientConfig(enabledServers, userId);

  if (Object.keys(mcpConfig.mcpServers).length === 0) {
    console.log("No enabled MCP servers, returning empty tools list.");
    return [];
  }

  console.log(
    "Initializing MCP client with servers:",
    Object.keys(mcpConfig.mcpServers)
  );

  try {
    // 2. Pass the config object DIRECTLY to the constructor.
    const mcpClient = new MultiServerMCPClient(mcpConfig);

    // 3. getTools() will implicitly initialize the connections.
    const tools = await mcpClient.getTools();
    
    // Optional: You might want to hold onto the client instance to close it later
    // For example, by attaching it to the graph's state or a global manager.
    // await mcpClient.close();
    
    return tools;
  } catch (error) {
    console.error("Failed to initialize MCP Client or get tools:", error);
    // Return empty array or re-throw, depending on desired behavior
    return [];
  }
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to find information`;

// Cache for tools based on enabled MCP server configuration
const toolCache = new Map<string, StructuredToolInterface[]>();

// Initialize an empty tool node; tools will be populated per run
const toolNode = new ToolNode([]);

// Base model instance; tools will be bound dynamically
const baseModel = new ChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.5,
});

// Define the function that determines whether to continue or not
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    return "tools";
  }
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
  const agentConfig = config.configurable as AgentConfiguration;
  const userId = (config.configurable as { agentId?: string })?.agentId;
  const systemPrompt = agentConfig.prompt_template || DEFAULT_SYSTEM_PROMPT;
  const memoryEnabled = agentConfig.memory?.enabled ?? true; // Default to enabled if not specified

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

  // Combine system prompt with memory context
  const enhancedSystemPrompt = `${systemPrompt}${memoryContext}`;

  const enabledServers = agentConfig.enabled_mcp_servers || [];
  const cacheKey = `${enabledServers.slice().sort().join(",")}-${userId}`;
  let tools = toolCache.get(cacheKey);
  if (!tools) {
    tools = await initializeMCPClient(enabledServers, userId);
    toolCache.set(cacheKey, tools);
  }

  toolNode.tools = tools;
  const modelWithTools = baseModel.bindTools(tools);

  const response = await modelWithTools.invoke([
    new SystemMessage(enhancedSystemPrompt),
    ...state.messages,
  ]);

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