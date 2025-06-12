import { NextRequest, NextResponse } from "next/server";
import { OAuthManager } from "@/lib/agent/oauth";
import { createClient } from "@/supabase/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  try {
    const { provider } = await request.json();

    if (!provider) {
      return NextResponse.json(
        { error: "Provider is required" },
        { status: 400 }
      );
    }

    // Verify user authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    try {
      // Generate OAuth URL
      const oauthManager = new OAuthManager(provider);
      const state = uuidv4(); // Generate random state for security
      const authUrl = oauthManager.generateAuthUrl(state, user.id);

      return NextResponse.json({
        authUrl,
        provider,
        message: "Redirect to this URL to complete OAuth flow",
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unknown OAuth provider")) {
        return NextResponse.json(
          { error: `Unsupported OAuth provider: ${provider}` },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("OAuth initiation error:", error);
    return NextResponse.json(
      { error: "Failed to initiate OAuth flow" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

    if (!provider) {
      return NextResponse.json(
        { error: "Provider parameter is required" },
        { status: 400 }
      );
    }

    // Verify user authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    try {
      // Check if user has valid token
      const oauthManager = new OAuthManager(provider);
      const hasToken = await oauthManager.hasValidToken(user.id);

      return NextResponse.json({
        provider,
        hasToken,
        connected: hasToken,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unknown OAuth provider")) {
        return NextResponse.json(
          { error: `Unsupported OAuth provider: ${provider}` },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("OAuth status check error:", error);
    return NextResponse.json(
      { error: "Failed to check OAuth status" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

    if (!provider) {
      return NextResponse.json(
        { error: "Provider parameter is required" },
        { status: 400 }
      );
    }

    // Verify user authentication
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    try {
      // Revoke token
      const oauthManager = new OAuthManager(provider);
      await oauthManager.revokeToken(user.id);

      return NextResponse.json({
        provider,
        message: "OAuth token revoked successfully",
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unknown OAuth provider")) {
        return NextResponse.json(
          { error: `Unsupported OAuth provider: ${provider}` },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("OAuth revocation error:", error);
    return NextResponse.json(
      { error: "Failed to revoke OAuth token" },
      { status: 500 }
    );
  }
} 