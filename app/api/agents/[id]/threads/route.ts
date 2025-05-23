import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/supabase/server";
import { Client } from "@langchain/langgraph-sdk";


export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const client = new Client({
    apiUrl: process.env.LANGGRAPH_URL,
    apiKey: process.env.LANGSMITH_API_KEY,
  });

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate agent ownership from the database
    const { data: userAgent, error: userAgentError } = await supabase
      .from("user_agents")
      .select("agent_id")
      .eq("user_id", user.id)
      .eq("agent_id", id)
      .single();

    if (userAgentError || !userAgent) {
      return NextResponse.json(
        { error: "Agent not found or access denied" },
        { status: 404 }
      );
    }

    // Get the agent configuration from the database
    const { data: agent, error: agentError } = await supabase
      .from("agent")
      .select("*")
      .eq("id", id)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: "Failed to fetch agent configuration" },
        { status: 500 }
      );
    }

    // Create a thread using LangGraph API with agent data
    const thread = await client.threads.create({
      metadata: {
        user_id: user.id,
        agent_id: id,
        agent_name: agent.name,
        agent_config: JSON.stringify(agent.config),
      },
    });

    return NextResponse.json({ thread_id: thread.thread_id });
  } catch (error) {
    console.error("Error creating thread:", error);
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    );
  }
}

// GET - List all threads for an agent

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const client = new Client({
    apiUrl: process.env.LANGGRAPH_URL,
    apiKey: process.env.LANGSMITH_API_KEY,
  });
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate agent ownership from the database
    const { data: userAgent, error: userAgentError } = await supabase
      .from("user_agents")
      .select("agent_id")
      .eq("user_id", user.id)
      .eq("agent_id", id)
      .single();

    if (userAgentError || !userAgent) {
      return NextResponse.json(
        { error: "Agent not found or access denied" },
        { status: 404 }
      );
    }

    // Search for threads with this user_id and agent_id in metadata
    const threads = await client.threads.search({
      metadata: {
        user_id: user.id,
        agent_id: id,
      },
      limit: 100,
    });
    return NextResponse.json({ threads });
  } catch (error) {
    console.error("Error fetching threads:", error);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 }
    );
  }
}
