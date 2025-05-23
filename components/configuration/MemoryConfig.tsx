"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AgentConfiguration } from "@/types/agent";
import { useRouter } from "next/navigation";

interface MemoryConfigProps {
  config: AgentConfiguration;
  onChange: (field: keyof AgentConfiguration, value: unknown) => void;
  agentId?: string;
}

export function MemoryConfig({ config, onChange, agentId }: MemoryConfigProps) {
  const router = useRouter();

  const handleMemoryToggle = (enabled: boolean) => {
    onChange("memory", {
      ...config.memory,
      enabled,
    });
  };

  const navigateToMemoryManager = () => {
    if (agentId) {
      router.push(`/agents/${agentId}/memories`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Memory</Label>
            <p className="text-sm text-muted-foreground">
              Enable memory to let your agent remember information about you
            </p>
          </div>
          <Switch
            checked={config.memory?.enabled || false}
            onCheckedChange={handleMemoryToggle}
          />
        </div>

        {config.memory?.enabled && (
          <div className="pt-2">
            <Button
              variant="outline"
              onClick={navigateToMemoryManager}
              disabled={!agentId}
            >
              Manage Memories
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              View and manage stored information your agent has learned about
              you
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
