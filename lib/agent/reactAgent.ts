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
  LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RunnableConfig } from "@langchain/core/runnables";
import { AgentConfiguration } from "@/types/agent";
import { retrieveRelevantDocuments } from "@/lib/retrieval";
import fs from "fs";
import { createClient } from "@/supabase/client";
import { v4 as uuidv4 } from "uuid";
import { getUserMcpServers } from "./getUserMcpServers";

// Initialize the memory store
export const store = new InMemoryStore();

// Local implementation of createSmitheryUrl to avoid SDK import issues
interface SmitheryUrlOptions {
  config?: any;
  apiKey?: string;
  profile?: string;
}

function createSmitheryUrl(baseUrl: string, options?: SmitheryUrlOptions): URL {
  const url = new URL(`${baseUrl}/mcp`);
  
  if (options?.config) {
    const param = typeof window !== "undefined"
      ? btoa(JSON.stringify(options.config))
      : Buffer.from(JSON.stringify(options.config)).toString("base64");
    url.searchParams.set("config", param);
  }
  
  if (options?.apiKey) {
    url.searchParams.set("api_key", options.apiKey);
  }
  
  if (options?.profile) {
    url.searchParams.set("profile", options.profile);
  }
  
  return url;
}

// Function to extract and write user memories
async function writeMemory(state: AgentState, config: LangGraphRunnableConfig) {
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
      model: "gpt-4.1-mini",
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

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to find information`;

// --- MAIN ENTRY POINT ---

// NOTE: This function is kept for backward compatibility but is no longer used.
// All production traffic goes through the LangGraph Platform deployed graph below.
export async function createAgentGraphForUserAgent(
  userId: string,
  agentConfig: AgentConfiguration
) {
  console.warn("createAgentGraphForUserAgent is deprecated. Use LangGraph Platform deployment instead.");
  // Implementation removed - use the deployed graph on LangGraph Platform
  return null;
}

// Dynamic tool node that can handle runtime tool loading
class DynamicToolNode extends ToolNode {
  constructor() {
    super([]);
  }

  async invoke(state: any, config: any): Promise<any> {
    const agentConfig = config.configurable as AgentConfiguration;
    const userId = config.configurable.agentId as string;
    
    // Dynamically load MCP tools based on configuration
    const tools: any[] = [];
    if (agentConfig.enabled_mcp_servers && agentConfig.enabled_mcp_servers.length > 0) {
      try {
        const allServers = await getUserMcpServers(userId);
        
        for (const qualifiedName of agentConfig.enabled_mcp_servers) {
          if (allServers[qualifiedName]) {
            const serverConfig = allServers[qualifiedName];
            
            try {
              // Create Smithery URL with configuration
              const serverUrl = createSmitheryUrl(serverConfig.url, {
                config: serverConfig.config,
                apiKey: serverConfig.apiKey
              });

              // Create StreamableHTTP transport
              const transport = new StreamableHTTPClientTransport(serverUrl);

              // Create MCP client
              const client = new Client({
                name: "AgentHub",
                version: "1.0.0"
              });

              // Connect to the server
              await client.connect(transport);

              // Get tools from this server
              const serverTools = await client.listTools();
              if (serverTools.tools) {
                // Add server prefix to tool names to avoid conflicts
                const prefixedTools = serverTools.tools.map(tool => ({
                  ...tool,
                  name: `${qualifiedName}__${tool.name}`,
                  originalName: tool.name,
                  serverName: qualifiedName
                }));
                tools.push(...prefixedTools);
              }
            } catch (error) {
              console.error(`Failed to connect to MCP server ${qualifiedName}:`, error);
            }
          }
        }
      } catch (error) {
        console.error("Error loading MCP servers:", error);
      }
    }
    
    // Update tools if any were loaded
    if (tools.length > 0) {
      (this as any).tools = tools;
    }
    
    // Call the parent invoke method
    return super.invoke(state, config);
  }
}

// Define the function that calls the model with dynamic configuration
async function callModel(
  state: typeof MessagesAnnotation.State,
  config: LangGraphRunnableConfig
) {
  const store = config.store;
  if (!store) {
    throw new Error("store is required when compiling the graph");
  }
  if (!config.configurable?.agentId) {
    throw new Error("agentId is required in the config");
  }
  
  const agentConfig = config.configurable as AgentConfiguration;
  const userId = config.configurable.agentId as string;
  const systemPrompt = agentConfig.prompt_template || DEFAULT_SYSTEM_PROMPT;
  const memoryEnabled = agentConfig.memory?.enabled ?? true;
  
  // Retrieve user memories
  const memories = await retrieveMemories(userId, memoryEnabled);
  
  // Format memories for inclusion in the prompt
  let memoryContext = "";
  if (memories.length > 0 && memoryEnabled) {
    memoryContext = "\n\nUser Profile Information:\n";
    const profileData: Record<string, unknown> = {};
    memories.forEach((memory) => {
      const { attribute, value } = memory.value as {
        attribute: string;
        value: unknown;
      };
      if (attribute && value) {
        profileData[attribute] = value;
      }
    });
    for (const [attribute, value] of Object.entries(profileData)) {
      if (Array.isArray(value)) {
        memoryContext += `- ${attribute}: ${value.join(", ")}\n`;
      } else {
        memoryContext += `- ${attribute}: ${value}\n`;
      }
    }
  }

  // Dynamically load MCP tools based on configuration
  const tools: any[] = [];
  if (agentConfig.enabled_mcp_servers && agentConfig.enabled_mcp_servers.length > 0) {
    try {
      const allServers = await getUserMcpServers(userId);
      
      for (const qualifiedName of agentConfig.enabled_mcp_servers) {
        if (allServers[qualifiedName]) {
          const serverConfig = allServers[qualifiedName];
          
          try {
            // Create Smithery URL with configuration
            const serverUrl = createSmitheryUrl(serverConfig.url, {
              config: serverConfig.config,
              apiKey: serverConfig.apiKey
            });

            // Create StreamableHTTP transport
            const transport = new StreamableHTTPClientTransport(serverUrl);

            // Create MCP client
            const client = new Client({
              name: "AgentHub",
              version: "1.0.0"
            });

            // Connect to the server
            await client.connect(transport);

            // Get tools from this server
            const serverTools = await client.listTools();
            if (serverTools.tools) {
              // Add server prefix to tool names to avoid conflicts
              const prefixedTools = serverTools.tools.map(tool => ({
                ...tool,
                name: `${qualifiedName}__${tool.name}`,
                originalName: tool.name,
                serverName: qualifiedName
              }));
              tools.push(...prefixedTools);
            }
          } catch (error) {
            console.error(`Failed to connect to MCP server ${qualifiedName}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Error loading MCP servers:", error);
    }
  }
  
  // Create a model and give it access to the tools
  const model = new ChatOpenAI({
    model: agentConfig.model || "gpt-4o-mini",
    temperature: agentConfig.temperature || 0.5,
  }).bindTools(tools);
  
  // Combine system prompt with memory context
  const enhancedSystemPrompt = `${systemPrompt}${memoryContext}`;
  const response = await model.invoke([
    new SystemMessage(enhancedSystemPrompt),
    ...state.messages,
  ]);
  return { messages: [response] };
}

// Define the function that determines whether to continue or not
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    return "tools";
  }
  return "__end__";
}

// Create a dynamic tool node that can handle runtime tool loading
const dynamicToolNode = new DynamicToolNode();

// Define and export the graph for LangGraph Platform
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("retrieveKb", retrieveKb)
  .addNode("writeMemory", writeMemory)
  .addNode("agent", callModel)
  .addNode("tools", dynamicToolNode)
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

  // Conditional path from agent based on whether additional tools are needed
  .addConditionalEdges("agent", shouldContinue);

// ============================================================================
// LANGGRAPH PLATFORM DEPLOYMENT
// ============================================================================
// This is the ONLY graph version you need for production!
// 
// Architecture:
// 1. ONE deployed graph handles ALL agents
// 2. Agent-specific configs (model, tools, memory) passed via config.configurable
// 3. Supports long-running tasks, cron jobs, and scaling
// 4. Used by all your Next.js API routes
//
// Benefits:
// ✅ Scalable - LangGraph Platform handles infrastructure
// ✅ Persistent - Long-running tasks and workflows
// ✅ Flexible - Each agent can have different configurations
// ✅ Efficient - One deployment, multiple use cases
// ============================================================================

export const graph = workflow.compile();
