"use client";

import React, { useCallback, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AgentConfiguration, ModelType, AgentMetadata } from "@/types/agent";
import { createClient } from "@/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { mutate } from "swr";
import { Slider } from "@/components/ui/slider";
import { useRouter } from "next/navigation";
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
import { toast } from "@/hooks/use-toast";

interface GeneralConfigProps {
  config: {
    id: string;
    name: string;
    description: string;
    metadata: AgentMetadata;
    config: AgentConfiguration;
    agent_avatar?: string | null;
  };
  onChange: (field: string, value: unknown) => void;
  onConfigurableChange: (
    field: keyof AgentConfiguration,
    value: unknown
  ) => void;
}

export function GeneralConfig({
  config,
  onChange,
  onConfigurableChange,
}: GeneralConfigProps) {
  const supabase = createClient();
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      try {
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
          throw new Error("File size must be less than 5MB");
        }

        // Check file type
        if (!file.type.startsWith("image/")) {
          throw new Error("File must be an image");
        }

        const fileExt = file.name.split(".").pop();
        const fileName = `${config.id}-${Date.now()}.${fileExt}`;
        const filePath = `${config.metadata.owner_id}/${fileName}`;

        // Delete old avatar if it exists
        if (config.agent_avatar) {
          const oldFilePath = config.agent_avatar.split("/").pop();
          if (oldFilePath) {
            await supabase.storage
              .from("agent-avatars")
              .remove([`${config.metadata.owner_id}/${oldFilePath}`]);
          }
        }

        const { error: uploadError } = await supabase.storage
          .from("agent-avatars")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("agent-avatars").getPublicUrl(filePath);

        // Update the avatar in the parent component
        onChange("avatar", publicUrl);

        // Save the changes immediately to persist the avatar
        const response = await fetch(`/api/agents/${config.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...config,
            avatar: publicUrl,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to update agent with new avatar");
        }

        // Update SWR cache
        await mutate(`/api/agents/${config.id}`);
        await mutate("/api/agents");
      } catch (error) {
        console.error("Error uploading avatar:", error);
        if (error instanceof Error) {
          alert(error.message);
        } else {
          alert("Failed to upload avatar");
        }
      } finally {
        setIsUploading(false);
        // Reset the file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [config, onChange, supabase.storage]
  );

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/agents/${config.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete agent");
      }

      await mutate("/api/agents");
      router.push("/agents");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center">
        <div className="mb-4">
          <Avatar className="h-24 w-24">
            <AvatarImage src={config.agent_avatar || ""} alt={config.name} />
            <AvatarFallback
              style={{
                backgroundColor: `hsl(${
                  (config.name.length * 30) % 360
                }, 70%, 50%)`,
              }}
              className="text-xl font-medium text-white"
            >
              {config.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={triggerFileInput}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {isUploading
              ? "Uploading..."
              : config.agent_avatar
              ? "Change Avatar"
              : "Upload Avatar"}
          </Button>
          {config.agent_avatar && !isUploading && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange("agent_avatar", null)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={config.name}
          onChange={(e) => onChange("name", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={config.description}
          onChange={(e) => onChange("description", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">Model</Label>
        <Select
          value={config.config.model}
          onValueChange={(value: ModelType) =>
            onConfigurableChange("model", value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4o">GPT-4o</SelectItem>
            <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
            <SelectItem value="gpt-o1">GPT-O1</SelectItem>
            <SelectItem value="gpt-o1-mini">GPT-O1 Mini</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Temperature: {config.config.temperature}</Label>
        <Slider
          value={[config.config.temperature]}
          min={0}
          max={1}
          step={0.1}
          onValueChange={([value]) =>
            onConfigurableChange("temperature", value)
          }
        />
      </div>
      <div className="border-t pt-4">
        <h3 className="text-lg font-medium mb-2">Danger Zone</h3>
        <p className="text-sm text-muted-foreground mb-4">
          These actions are destructive and cannot be undone. Deleting this
          agent will cause any workflows using it to fail.
        </p>
        <Button
          variant="destructive"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          Delete Agent
        </Button>
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
    </div>
  );
}
