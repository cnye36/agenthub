import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/supabase/server";
import { OAuthManager, OAUTH_PROVIDERS } from "@/lib/agent/oauth";

export async function GET(request: NextRequest) {
  try {
    console.log("=== OAuth Debug Endpoint ===");
    
    // Check if we can create the Supabase client
    const supabase = await createClient();
    console.log("✅ Supabase client created successfully");

    // Try to get the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log("User error:", userError);
    console.log("User data:", user ? { id: user.id, email: user.email } : null);

    // Check if we can query the oauth_tokens table
    try {
      const { data: tokensCheck, error: tokensError } = await supabase
        .from("oauth_tokens")
        .select("*", { count: "exact" })
        .limit(1);
      
      console.log("✅ oauth_tokens table accessible", { tokensCheck, tokensError });
    } catch (dbError) {
      console.log("❌ oauth_tokens table error:", dbError);
    }

    // Check environment variables
    const envCheck = {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: !!process.env.GOOGLE_REDIRECT_URI,
    };

    // Show OAuth provider configuration
    const googleConfig = OAUTH_PROVIDERS.google;
    
    // Generate a sample OAuth URL to see what would be sent
    let sampleOAuthUrl = null;
    if (user) {
      try {
        const oauthManager = new OAuthManager("google");
        sampleOAuthUrl = oauthManager.generateAuthUrl("debug-state", user.id);
      } catch (error) {
        console.error("Failed to generate sample OAuth URL:", error);
      }
    }

    return NextResponse.json({
      debug: "OAuth Debug Information",
      hasUser: !!user,
      userId: user?.id || null,
      userEmail: user?.email || null,
      userError: userError?.message || null,
      timestamp: new Date().toISOString(),
      environment: envCheck,
      googleOAuthConfig: {
        clientId: googleConfig.clientId?.substring(0, 20) + "..." || "NOT_SET",
        clientIdLength: googleConfig.clientId?.length || 0,
        redirectUri: googleConfig.redirectUri,
        authUrl: googleConfig.authUrl,
        scopes: googleConfig.scopes,
      },
      sampleOAuthUrl: sampleOAuthUrl?.substring(0, 200) + "..." || null,
      troubleshooting: {
        message: "If you're getting 'invalid_client' error, check:",
        steps: [
          "1. GOOGLE_CLIENT_ID exactly matches Google Console",
          "2. GOOGLE_REDIRECT_URI exactly matches authorized redirect URIs in Google Console",
          "3. Make sure the Google project is not in testing mode with restricted users",
          "4. Verify OAuth consent screen is properly configured"
        ]
      }
    });
  } catch (error) {
    console.error("Debug endpoint error:", error);
    return NextResponse.json(
      { 
        error: "Debug endpoint failed", 
        details: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
} 