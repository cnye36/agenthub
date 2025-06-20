"use client"

import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Eye, EyeOff, AlertTriangle, ExternalLink, CheckCircle, XCircle } from "lucide-react";
import { AVAILABLE_MCP_SERVERS } from "@/lib/mcpToolIndex";
import { Alert, AlertDescription } from "@/components/ui/alert";

type MCPServer = {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredCredentials: string[];
  credentials?: Record<string, string>;
  requiresOAuth?: boolean;
  oauthProvider?: string;
};

type MCPServers = Record<string, MCPServer>;

interface ToolSelectorProps {
  enabledMCPServers: string[];
  onMCPServersChange: (servers: string[]) => void;
}

export function ToolSelector({
  enabledMCPServers = [],
  onMCPServersChange,
}: ToolSelectorProps) {
  const [openConfigs, setOpenConfigs] = useState<Record<string, boolean>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>(
    {}
  );
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [oauthStatuses, setOauthStatuses] = useState<
    Record<string, boolean>
  >({});
  const [isConnecting, setIsConnecting] = useState<
    Record<string, boolean>
  >({});

  const servers = AVAILABLE_MCP_SERVERS as MCPServers;

  const toggleConfig = (toolId: string) => {
    setOpenConfigs((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  const togglePasswordVisibility = (toolId: string, credentialKey: string) => {
    const key = `${toolId}-${credentialKey}`;
    setShowPasswords((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleConfigChange = (
    toolId: string,
    changes: Record<string, string>
  ) => {
    const server = servers[toolId];
    if (!server) return;

    // Update the server's credentials
    server.credentials = {
      ...server.credentials,
      ...changes,
    };
    validateToolConfig(toolId);
  };

  const handleToggleTool = (serverId: string) => {
    if (!onMCPServersChange) return;

    const isEnabled = enabledMCPServers.includes(serverId);
    const server = servers[serverId];

    if (!isEnabled && server.requiredCredentials.length > 0) {
      const isValid = validateToolConfig(serverId);
      if (!isValid) {
        setOpenConfigs((prev) => ({
          ...prev,
          [serverId]: true,
        }));
        return;
      }
    }

    const updatedServers = isEnabled
      ? enabledMCPServers.filter((id) => id !== serverId)
      : [...enabledMCPServers, serverId];

    onMCPServersChange(updatedServers);
  };

  const checkOAuthStatus = async (serverId: string) => {
    const server = servers[serverId];
    if (!server.requiresOAuth || !server.oauthProvider) return;

    try {
      const response = await fetch(`/api/auth/oauth?provider=${server.oauthProvider}`);
      const data = await response.json();
      
      setOauthStatuses((prev) => ({
        ...prev,
        [serverId]: data.connected || false,
      }));
    } catch (error) {
      console.error(`Failed to check OAuth status for ${serverId}:`, error);
      setOauthStatuses((prev) => ({
        ...prev,
        [serverId]: false,
      }));
    }
  };

  const initiateOAuthFlow = async (serverId: string) => {
    const server = servers[serverId];
    if (!server.requiresOAuth || !server.oauthProvider) return;

    setIsConnecting((prev) => ({ ...prev, [serverId]: true }));

    try {
      const response = await fetch("/api/auth/oauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider: server.oauthProvider }),
      });

      const data = await response.json();
      
      if (response.ok && data.authUrl) {
        // Open OAuth URL in new window
        window.open(data.authUrl, "oauth", "width=500,height=600");
        
        // Poll for OAuth completion (simplified approach)
        const pollInterval = setInterval(async () => {
          await checkOAuthStatus(serverId);
          if (oauthStatuses[serverId]) {
            clearInterval(pollInterval);
            setIsConnecting((prev) => ({ ...prev, [serverId]: false }));
          }
        }, 2000);
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsConnecting((prev) => ({ ...prev, [serverId]: false }));
        }, 300000);
      } else {
        throw new Error(data.error || "Failed to initiate OAuth flow");
      }
    } catch (error) {
      console.error(`OAuth flow failed for ${serverId}:`, error);
      setIsConnecting((prev) => ({ ...prev, [serverId]: false }));
    }
  };

  const revokeOAuth = async (serverId: string) => {
    const server = servers[serverId];
    if (!server.requiresOAuth || !server.oauthProvider) return;

    try {
      const response = await fetch(`/api/auth/oauth?provider=${server.oauthProvider}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setOauthStatuses((prev) => ({
          ...prev,
          [serverId]: false,
        }));
      }
    } catch (error) {
      console.error(`Failed to revoke OAuth for ${serverId}:`, error);
    }
  };

  const validateToolConfig = (serverId: string): boolean => {
    const server = servers[serverId];
    
    // Check OAuth requirements
    if (server.requiresOAuth && !oauthStatuses[serverId]) {
      setValidationErrors((prev) => ({
        ...prev,
        [serverId]: `OAuth connection required for ${server.name}`,
      }));
      return false;
    }
    
    if (!server.requiredCredentials.length) return true;

    const credentials = server.credentials || {};
    const missingCredentials = server.requiredCredentials.filter(
      (cred: string) => !credentials[cred]
    );

    if (missingCredentials.length > 0) {
      setValidationErrors((prev) => ({
        ...prev,
        [serverId]: `Missing required credentials: ${missingCredentials
          .map((cred: string) =>
            cred
              .split("_")
              .map(
                (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
              )
              .join(" ")
          )
          .join(", ")}`,
      }));
      return false;
    }

    setValidationErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([key]) => key !== serverId)
      )
    );
    return true;
  };

  // Check OAuth statuses on component mount
  React.useEffect(() => {
    Object.keys(servers).forEach((serverId) => {
      const server = servers[serverId];
      if (server.requiresOAuth) {
        checkOAuthStatus(serverId);
      }
    });
  }, []);

  return (
    <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
      <h3 className="text-lg font-semibold sticky top-0 bg-background py-2">
        Tools
      </h3>
      <div className="space-y-2">
        {Object.entries(servers).map(([id, tool]) => (
          <Collapsible
            key={id}
            open={openConfigs[id]}
            onOpenChange={() => toggleConfig(id)}
          >
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div className="flex items-center space-x-4">
                <tool.icon className="h-6 w-6" />
                <div className="space-y-1">
                  <div className="font-medium">{tool.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {tool.description}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                {(tool.requiredCredentials.length > 0 || tool.requiresOAuth) && (
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                )}
                <Switch
                  checked={enabledMCPServers.includes(id)}
                  onCheckedChange={() => handleToggleTool(id)}
                  
                />
              </div>
            </div>

            {(tool.requiredCredentials.length > 0 || tool.requiresOAuth) && (
              <CollapsibleContent className="p-4 bg-muted/50 rounded-lg mt-2 space-y-4">
                {validationErrors[id] && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{validationErrors[id]}</AlertDescription>
                  </Alert>
                )}

                {/* OAuth Connection Section */}
                {tool.requiresOAuth && (
                  <div className="space-y-3 p-3 border rounded-lg bg-background">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Label className="text-sm font-medium">
                          OAuth Connection
                        </Label>
                        {oauthStatuses[id] ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {oauthStatuses[id] ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revokeOAuth(id)}
                          >
                            Disconnect
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => initiateOAuthFlow(id)}
                            disabled={isConnecting[id]}
                          >
                            {isConnecting[id] ? (
                              "Connecting..."
                            ) : (
                              <>
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Connect
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {oauthStatuses[id]
                        ? `Connected to ${tool.name} via OAuth`
                        : `Connect your ${tool.name} account to use this tool`}
                    </p>
                  </div>
                )}

                {/* Credential Input Section */}
                {tool.requiredCredentials.map((cred: string) => (
                  <div key={cred} className="space-y-2">
                    <Label
                      htmlFor={`${id}-${cred}`}
                      className="flex items-center space-x-1"
                    >
                      <span>
                        {cred
                          .split("_")
                          .map(
                            (word: string) =>
                              word.charAt(0).toUpperCase() + word.slice(1)
                          )
                          .join(" ")}
                      </span>
                      <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id={`${id}-${cred}`}
                        type={
                          showPasswords[`${id}-${cred}`] ? "text" : "password"
                        }
                        value={servers[id]?.credentials?.[cred] ?? ""}
                        onChange={(e) =>
                          handleConfigChange(id, {
                            [cred]: e.target.value,
                          })
                        }
                        required
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => togglePasswordVisibility(id, cred)}
                      >
                        {showPasswords[`${id}-${cred}`] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            )}
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
