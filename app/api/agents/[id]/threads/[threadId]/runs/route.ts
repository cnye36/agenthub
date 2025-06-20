import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/supabase/server";
import { Client } from "@langchain/langgraph-sdk";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; threadId: string } }
) {
  const { id, threadId } = params;
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

    // Get the thread to verify it belongs to this agent
    const thread = await client.threads.get(threadId);

    if (!thread || thread.metadata?.agent_id !== id) {
      return NextResponse.json(
        { error: "Thread not found or doesn't belong to this agent" },
        { status: 404 }
      );
    }

    const runs = await client.runs.list(threadId);
    return NextResponse.json(runs || []);
  } catch (error) {
    console.error("Error fetching runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch runs" },
      { status: 500 }
    );
  }
}

// POST - Create a new run/message in a thread
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; threadId: string } }
) {
  const { id, threadId } = params;
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

    // Get the thread to verify it belongs to this agent
    const thread = await client.threads.get(threadId);

    if (!thread || thread.metadata?.agent_id !== id) {
      return NextResponse.json(
        { error: "Thread not found or doesn't belong to this agent" },
        { status: 404 }
      );
    }

    // Get agent configuration from the database
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

    console.log("=== Agent Config Debug ===");
    console.log("Agent from DB:", JSON.stringify(agent, null, 2));
    console.log("Agent config:", JSON.stringify(agent.config, null, 2));

    const { content } = await request.json();
    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "Invalid message content" },
        { status: 400 }
      );
    }

    // Create a transform stream for SSE
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Start streaming in the background
    (async () => {
      try {
        // Use "reactAgent" as the fixed graph_id for all agents
        const graphId = "reactAgent";

        const configurable = {
          ...(agent.config || {}),
          agentId: id,
        };
        
        console.log("=== Config to be sent to graph ===");
        console.log("configurable:", JSON.stringify(configurable, null, 2));

        const eventStream = client.runs.stream(threadId, graphId, {
          input: { messages: [{ role: "user", content }] },
          config: {
            tags: ["chat"],
            configurable,
            recursion_limit: 100,
          },
          streamMode: ["messages"],
        });

        for await (const event of eventStream) {
          if (
            Array.isArray(event.data) &&
            event.data[0]?.content !== undefined
          ) {
            const chunk = `data: ${JSON.stringify(event.data)}\n\n`;
            await writer.write(encoder.encode(chunk));
          }
        }
      } catch (error) {
        console.error("Stream error:", error);
        const errorEvent = {
          event: "error",
          data: { message: "An error occurred while streaming the response" },
        };
        await writer.write(
          encoder.encode(`data: ${JSON.stringify([errorEvent])}\n\n`)
        );
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in POST:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
