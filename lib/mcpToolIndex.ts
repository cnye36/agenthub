import { Search, Brain, Database, Mail, File, Calendar } from "lucide-react";

export const AVAILABLE_MCP_SERVERS = {
  tavily: {
    name: "Tavily Search",
    description: "AI-powered web search and content extraction",
    icon: Search,
    requiredCredentials: ["tavily_api_key"],
    isEnabled: false, 
  },
  sequential_thinking: {
    name: "Sequential Thinking",
    description: "Think step by step",
    icon: Brain,
    requiredCredentials: [],
  },
  notionApi: {
    name: "Notion API",
    description: "Notion API",
    icon: Database,
    requiredCredentials: ["notion_integration_secret"],
  },
  "gmail-mcp-server": {
    name: "Gmail",
    description: "Gmail email management and operations",
    icon: Mail,
    requiredCredentials: [],
    requiresOAuth: true,
    oauthProvider: "google",
  },
  
  
};
