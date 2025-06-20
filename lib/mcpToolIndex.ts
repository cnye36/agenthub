import { Search, Brain, Database, Mail, File, Calendar } from "lucide-react";
import { SiCanva } from "react-icons/si";

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
  firecrawl: {
    name: "Firecrawl",
    description: "Firecrawl API",
    icon: Search,
    requiredCredentials: ["firecrawl_api_key"],
  },
  
  "canva-dev": {
    name: "Canva",
    description: "Canva API",
    icon: SiCanva,
    requiredCredentials: [],
  },
  
};
