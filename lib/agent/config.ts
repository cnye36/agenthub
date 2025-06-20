import { z } from "zod";
import { type LangGraphRunnableConfig } from "@langchain/langgraph";

export type ModelType = "gpt-4.1" | "gpt-4.1-mini" | "gpt-4.1-nano" | "gpt-o3";

// Memory options schema
export const AgentMemoryOptionsSchema = z.object({
  enabled: z.boolean(),
  max_entries: z.number(),
  relevance_threshold: z.number(),
});

// Knowledge base options schema
export const KnowledgeBaseOptionsSchema = z.object({
  isEnabled: z.boolean(),
  config: z.object({
    sources: z.array(z.string()),
  }),
});

// Metadata schema
export const AgentMetadataSchema = z.object({
  description: z.string(),
  agent_type: z.string(),
  user_id: z.string(),
});

// Configurable options schema
export const AgentConfigurableOptionsSchema = z.object({
  model: z.enum(["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-o3"]),
  temperature: z.number(),
  tools: z.array(z.string()),
  memory: AgentMemoryOptionsSchema,
  knowledge_base: KnowledgeBaseOptionsSchema.optional(),
  prompt_template: z.string(),
  agent_avatar: z.string(),
  enabled_mcp_servers: z.array(z.string()),
  agentId: z.string().optional(),
});

// Complete config schema
export const AgentConfigSchema = z.object({
  name: z.string(),
  configurable: AgentConfigurableOptionsSchema,
  config: z.custom<LangGraphRunnableConfig>().optional(),
});

// Export types derived from schemas
export type AgentMemoryOptions = z.infer<typeof AgentMemoryOptionsSchema>;
export type AgentConfigurableOptions = z.infer<
  typeof AgentConfigurableOptionsSchema
>;
export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
