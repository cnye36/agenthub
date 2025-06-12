import { NextRequest, NextResponse } from "next/server";
import { OAuthManager } from "@/lib/agent/oauth";
import { createClient } from "@/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle OAuth errors
  if (error) {
    console.error("OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/settings?error=oauth_${error}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings?error=missing_oauth_params", request.url)
    );
  }

  try {
    // Parse state to get userId
    const [stateToken, userId] = state.split(":");
    if (!userId) {
      throw new Error("Invalid state parameter");
    }

    // Verify user authentication  
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== userId) {
      throw new Error("Unauthorized");
    }

    // Exchange code for token
    const oauthManager = new OAuthManager("google");
    const token = await oauthManager.exchangeCodeForToken(code);
    
    // Store token in database
    await oauthManager.storeToken(userId, token);

    // Redirect to settings with success
    return NextResponse.redirect(
      new URL("/settings?oauth_success=google", request.url)
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/settings?error=oauth_callback_failed", request.url)
    );
  }
} 