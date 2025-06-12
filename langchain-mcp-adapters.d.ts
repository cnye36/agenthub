// In file: langchain-mcp-adapters.d.ts

// This declares the module to TypeScript and provides the necessary types.
declare module "@langchain/mcp-adapters" {
    import { StructuredToolInterface } from "@langchain/core/tools";
    import { Client } from "@modelcontextprotocol/sdk/client/index.js";
    import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
  
    /**
     * Defines how to handle a specific type of tool output.
     * 'content' will be passed to the LLM.
     * 'artifact' will be stored but not sent to the LLM.
     */
    export type OutputHandlingOption = "content" | "artifact";
  
    /**
     * Detailed configuration for handling different content types from tool outputs.
     */
    export interface DetailedOutputHandling {
      text?: OutputHandlingOption;
      image?: OutputHandlingOption;
      audio?: OutputHandlingOption;
      resource?: OutputHandlingOption;
      [key: string]: OutputHandlingOption | undefined;
    }
  
    /**
     * Defines where to place each tool output type in the LangChain ToolMessage.
     * Can be a single string ('content' or 'artifact') to apply to all types,
     * or a detailed object mapping each content type.
     */
    export type OutputHandling = OutputHandlingOption | DetailedOutputHandling;
  
    /**
     * Configuration for a stdio transport connection.
     */
    export interface StdioConnection {
      transport: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
      encoding?: string;
      stderr?: "overlapped" | "pipe" | "ignore" | "inherit";
      cwd?: string;
      restart?: {
        enabled?: boolean;
        maxAttempts?: number;
        delayMs?: number;
      };
      outputHandling?: OutputHandling;
    }
  
    /**
     * Configuration for a streamable HTTP or SSE transport connection.
     */
    export interface StreamableHTTPConnection {
      transport: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
      authProvider?: OAuthClientProvider; // Using 'any' if OAuthClientProvider is not explicitly defined in your project
      reconnect?: {
        enabled?: boolean;
        maxAttempts?: number;
        delayMs?: number;
      };
      automaticSSEFallback?: boolean;
      outputHandling?: OutputHandling;
    }
  
    /**
     * A union type for any valid transport connection.
     */
    export type Connection = StdioConnection | StreamableHTTPConnection;
  
    /**
     * Configuration for the MultiServerMCPClient.
     * This is the main type you need for your configuration object.
     */
    export interface ClientConfig {
      mcpServers: Record<string, Connection>;
      throwOnLoadError?: boolean;
      prefixToolNameWithServerName?: boolean;
      additionalToolNamePrefix?: string;
      useStandardContentBlocks?: boolean;
      outputHandling?: OutputHandling;
    }
  
    /**
     * Client for connecting to multiple MCP servers and loading LangChain-compatible tools.
     */
    export class MultiServerMCPClient {
      constructor(config: ClientConfig | Record<string, Connection>);
      
      /**
       * Returns a clone of the server config for inspection.
       */
      get config(): ClientConfig;
  
      /**
       * Proactively initializes connections to all servers.
       */
      initializeConnections(): Promise<Record<string, StructuredToolInterface[]>>;
  
      /**
       * Get tools from specified servers as a flattened array.
       */
      getTools(...servers: string[]): Promise<StructuredToolInterface[]>;
  
      /**
       * Get the MCP client for a specific server.
       */
      getClient(serverName: string): Promise<Client | undefined>;
  
      /**
       * Close all connections.
       */
      close(): Promise<void>;
    }
  }