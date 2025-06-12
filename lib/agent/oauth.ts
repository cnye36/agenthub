import { createClient } from "@/supabase/server";

export interface OAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret?: string; // Optional for PKCE flow
  redirectUri: string;
}

export interface OAuthToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
  scope?: string;
}

// OAuth provider configurations
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/callback/google",
  },
  twitter: {
    name: "Twitter/X",
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read"],
    clientId: process.env.TWITTER_CLIENT_ID || "",
    clientSecret: process.env.TWITTER_CLIENT_SECRET || "",
    redirectUri: process.env.TWITTER_REDIRECT_URI || "http://localhost:3000/api/auth/callback/twitter",
  },
  facebook: {
    name: "Facebook",
    authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    scopes: ["pages_read_engagement", "pages_manage_posts"],
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || "http://localhost:3000/api/auth/callback/facebook",
  },
};

export class OAuthManager {
  private provider: OAuthProvider;

  constructor(providerName: string) {
    const provider = OAUTH_PROVIDERS[providerName];
    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${providerName}`);
    }
    this.provider = provider;
  }

  /**
   * Generate the OAuth authorization URL
   */
  generateAuthUrl(state: string, userId: string): string {
    const params = new URLSearchParams({
      client_id: this.provider.clientId,
      redirect_uri: this.provider.redirectUri,
      scope: this.provider.scopes.join(" "),
      response_type: "code",
      state: `${state}:${userId}`, // Include userId in state
      access_type: "offline", // For refresh tokens
      prompt: "consent", // Force consent to get refresh token
    });

    return `${this.provider.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<OAuthToken> {
    const response = await fetch(this.provider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.provider.clientId,
        client_secret: this.provider.clientSecret || "",
        code,
        grant_type: "authorization_code",
        redirect_uri: this.provider.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenData = await response.json();
    
    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_in 
        ? Date.now() + (tokenData.expires_in * 1000) 
        : undefined,
      token_type: tokenData.token_type || "Bearer",
      scope: tokenData.scope,
    };
  }

  /**
   * Refresh an access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    const response = await fetch(this.provider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.provider.clientId,
        client_secret: this.provider.clientSecret || "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const tokenData = await response.json();
    
    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || refreshToken, // Keep existing if not provided
      expires_at: tokenData.expires_in 
        ? Date.now() + (tokenData.expires_in * 1000) 
        : undefined,
      token_type: tokenData.token_type || "Bearer",
      scope: tokenData.scope,
    };
  }

  /**
   * Store OAuth token in database
   */
  async storeToken(userId: string, token: OAuthToken): Promise<void> {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from("oauth_tokens")
      .upsert({
        user_id: userId,
        provider: this.provider.name.toLowerCase(),
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at ? new Date(token.expires_at).toISOString() : null,
        token_type: token.token_type,
        scope: token.scope,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,provider"
      });

    if (error) {
      throw new Error(`Failed to store token: ${error.message}`);
    }
  }

  /**
   * Retrieve OAuth token from database
   */
  async getToken(userId: string): Promise<OAuthToken | null> {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from("oauth_tokens")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", this.provider.name.toLowerCase())
      .single();

    if (error || !data) {
      return null;
    }

    const token: OAuthToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ? new Date(data.expires_at).getTime() : undefined,
      token_type: data.token_type,
      scope: data.scope,
    };

    // Check if token is expired and refresh if possible
    if (token.expires_at && token.expires_at < Date.now() && token.refresh_token) {
      try {
        const refreshedToken = await this.refreshToken(token.refresh_token);
        await this.storeToken(userId, refreshedToken);
        return refreshedToken;
      } catch (error) {
        console.error("Failed to refresh token:", error);
        return null;
      }
    }

    return token;
  }

  /**
   * Check if user has valid token for this provider
   */
  async hasValidToken(userId: string): Promise<boolean> {
    const token = await this.getToken(userId);
    return token !== null;
  }

  /**
   * Revoke/delete stored token
   */
  async revokeToken(userId: string): Promise<void> {
    const supabase = await createClient();
    
    const { error } = await supabase
      .from("oauth_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("provider", this.provider.name.toLowerCase());

    if (error) {
      throw new Error(`Failed to revoke token: ${error.message}`);
    }
  }
}

/**
 * Get OAuth token for MCP server
 */
export async function getMCPToken(userId: string, providerName: string): Promise<string | null> {
  try {
    const oauthManager = new OAuthManager(providerName);
    const token = await oauthManager.getToken(userId);
    return token?.access_token || null;
  } catch (error) {
    console.error(`Failed to get MCP token for ${providerName}:`, error);
    return null;
  }
} 