"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import { mutate } from "swr";

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    description: string;
    agent_avatar: string;
    config: {
      model: string;
      temperature: number;
      tools: Record<string, { isEnabled: boolean }>;
      memory: { enabled: boolean };
      knowledge_base: { isEnabled: boolean };
    };
  };
  onDelete: (agentId: string) => void;
}

export function AgentCard({ agent, onDelete }: AgentCardProps) {
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    // Prevent navigation when clicking delete button
    if ((e.target as HTMLElement).closest(".delete-button")) {
      e.stopPropagation();
      return;
    }

    if (!agent.id || agent.id === "undefined") {
      console.error("Invalid agent ID");
      return;
    }

    // Ensure the ID is properly formatted before navigation
    const agentId = encodeURIComponent(agent.id.trim());
    router.push(`/agents/${agentId}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete agent");
      }

      await mutate("/api/agents");
      onDelete(agent.id);
      setIsDeleteDialogOpen(false);
      toast({
        title: "Agent deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting agent:", error);
      toast({
        title: "Failed to delete agent",
        variant: "destructive",
      });
    }
  };

  // Get the avatar URL from the config
  const avatarUrl = agent.agent_avatar;

  return (
    <>
      <div
        className="border rounded-lg p-4 sm:p-6 hover:border-primary transition-colors cursor-pointer relative group"
        onClick={handleClick}
      >
        <Button
          variant="ghost"
          size="icon"
          className="delete-button absolute right-1 sm:right-2 top-1 sm:top-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
        <div className="flex items-start space-x-2 sm:space-x-4">
          <div
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-full ring-2 ring-background flex items-center justify-center text-xs sm:text-sm font-medium text-white"
            style={{
              backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundColor: !avatarUrl
                ? `hsl(${(agent.name.length * 30) % 360}, 70%, 50%)`
                : undefined,
            }}
          >
            {!avatarUrl && agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-semibold mb-1 truncate">
              {agent.name}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">
              {agent.description || "No description provided"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs sm:text-sm text-muted-foreground mt-3 sm:mt-4">
          <span className="flex items-center">
            Model: {agent.config.model || "Not specified"}
          </span>
          <span className="hidden sm:inline">•</span>
          <span>
            {agent.config.tools
              ? Object.values(agent.config.tools).filter(
                  (tool) => tool.isEnabled
                ).length
              : 0}{" "}
            tools
          </span>
        </div>
      </div>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              agent and any workflows using this agent will fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
