# MCP Test Agent

This is a clean, dedicated agent graph for testing MCP (Model Context Protocol) servers with LangGraph Platform.

## Key Features

- **Standard Agent Flow**: Uses the recommended approach from langchainjs-mcp-adapters (not React agent)
- **Dynamic Tool Loading**: Tools are loaded based on enabled MCP servers in the runnable config
- **Server Toggle Support**: Users can enable/disable specific MCP servers via configuration
- **Proper Error Handling**: Graceful handling of missing servers, OAuth failures, etc.
- **Tool Caching**: Efficient caching to avoid reinitializing tools on every call
- **Extensive Logging**: Detailed console output for debugging

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Start     │───▶│    Agent     │───▶│    End      │
└─────────────┘    └──────────────┘    └─────────────┘
                           │
                           ▼ (if tool calls)
                    ┌──────────────┐
                    │    Tools     │
                    └──────────────┘
                           │
                           └─────── ▲ (back to agent)
```

## Supported MCP Servers

1. **math** - Mathematical calculations (no auth required)
2. **tavily-mcp** - Web search (requires TAVILY_API_KEY env var)
3. **firecrawl** - Web scraping (requires FIRECRAWL_API_KEY env var)
4. **Notion** - Notion operations (no auth required for basic operations)
5. **gmail-mcp-server** - Gmail operations (requires OAuth with Google)

## Configuration

The agent expects a `configurable` object with `AgentConfiguration` type:

```typescript
{
  configurable: {
    model: "gpt-4.1",
    temperature: 0.5,
    enabled_mcp_servers: ["math", "tavily-mcp"], // Toggle servers here
    prompt_template: "You are a helpful assistant...",
    agentId: "user-123", // Required for OAuth and caching
    // ... other config
  }
}
```

## Testing

Run the test script:

```bash
npx tsx scripts/test-mcp-agent.ts
```

This will test different server combinations and show you:
- Which tools are loaded
- If tool calls are made
- Response quality
- Error handling

## Deployment

1. Add to `langgraph.json` (already done):
```json
{
  "graphs": {
    "mcpTestAgent": "./lib/agent/mcpTestAgent.ts:mcpTestGraph"
  }
}
```

2. Deploy to LangGraph Platform:
```bash
langgraph deploy
```

3. Test via API with different `enabled_mcp_servers` configurations

## Key Differences from React Agent

- **Uses ToolNode instead of createReactAgent**: More reliable with MCP tools
- **Manual tool binding**: Tools are fetched and bound to the model explicitly
- **Dynamic tool loading**: Tools are loaded per request based on configuration
- **Better error handling**: Graceful fallbacks when MCP servers fail

## Debugging

The agent includes extensive logging. Look for these log patterns:

- `=== Creating MCP Client Config ===` - Server configuration processing
- `=== Initializing MCP Tools ===` - Tool fetching from MCP servers
- `=== Model Call Node ===` - Model invocation with tools
- `Tool calls detected: X calls` - When tools are being used

## OAuth Integration

For OAuth-required servers (like Gmail), ensure:

1. User has completed OAuth flow
2. `getMCPToken(userId, provider)` returns valid token
3. Headers are processed correctly with `OAUTH:` prefix

## Next Steps

Once this test agent works correctly, apply the same patterns to your main `reactAgent.ts`:

1. Replace React agent approach with ToolNode approach
2. Use the same MCP client configuration pattern
3. Implement the same dynamic tool loading
4. Add the same error handling and logging 