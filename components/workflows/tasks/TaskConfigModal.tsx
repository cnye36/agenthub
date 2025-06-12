import React, { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Task } from "@/types/workflow";
import { toast } from "@/hooks/use-toast";
import { TaskModalHeader } from "./TaskModalHeader";
import { PreviousNodeOutputPanel } from "./PreviousNodeOutputPanel";
import { TaskConfigurationPanel } from "./TaskConfigurationPanel";
import { TestOutputPanel } from "./TestOutputPanel";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { AgentSelectModal } from "../AgentSelectModal";
import { Agent } from "@/types/agent";

interface TaskOutput {
  result: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface TaskConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  previousNodeOutput?: TaskOutput;
  onTest: () => Promise<unknown>;
  onUpdate: (updatedTask: Task, updatedAgent: Agent | null) => void;
}

type OutputFormat = "json" | "markdown" | "text";

type TestOutput = {
  type?: string;
  content?: string;
  result?: unknown;
  error?: string;
};

export function TaskConfigModal({
  isOpen,
  onClose,
  task,
  previousNodeOutput,
  onTest,
  onUpdate,
}: TaskConfigModalProps) {
  const [currentTask, setCurrentTask] = useState<Task>(task);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("json");
  const [isLoading, setIsLoading] = useState(false);
  const [testOutput, setTestOutput] = useState<TestOutput | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isAgentSelectOpen, setIsAgentSelectOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  useEffect(() => {
    setCurrentTask(task);
  }, [task]);

  useEffect(() => {
    let isMounted = true;

    const loadAssistants = async () => {
      try {
        const response = await fetch("/api/agents");
        if (!response.ok) throw new Error("Failed to load agents");
        const data = await response.json();
        if (isMounted) {
          setAgents(data);
          setLoadingAgents(false);
        }
      } catch (error) {
        console.error("Error loading agents:", error);
        if (isMounted) {
          setLoadingAgents(false);
        }
      }
    };

    if (isOpen) {
      loadAssistants();
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  useEffect(() => {
    let isMounted = true;

    const loadAssistant = async () => {
      if (!currentTask.assignedAgent?.id) return;

      try {
        setLoadingAgents(true);
        const response = await fetch(
          `/api/agents/${currentTask.assignedAgent?.id}`
        );
        if (!response.ok) throw new Error("Failed to load agent");
        const data = await response.json();
        if (isMounted) {
          setAgent(data);
        }
      } catch (error) {
        console.error("Error loading agent:", error);
        toast({
          title: "Failed to load assigned agent",
          variant: "destructive",
        });
      } finally {
        if (isMounted) {
          setLoadingAgents(false);
        }
      }
    };

    if (isOpen) {
      loadAssistant();
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentTask.assignedAgent?.id]);

  useEffect(() => {
    if (currentTask && agent) {
      onUpdate(currentTask, agent);
    }
  }, [currentTask, agent, onUpdate]);

  const handleTest = async () => {
    try {
      if (!currentTask.assignedAgent?.id) {
        throw new Error("Please assign an agent before testing");
      }

      setIsLoading(true);
      setIsStreaming(true);
      setTestOutput(null);

      if (!currentTask.config?.input?.prompt) {
        throw new Error("Please provide a prompt before testing");
      }

      const result = await onTest();
      setTestOutput(result as TestOutput);
    } catch (err) {
      console.error("Error testing task:", err);
      toast({
        title:
          typeof err === "string"
            ? err
            : err instanceof Error
            ? err.message
            : "Failed to test task",
        variant: "destructive",
      });
      setTestOutput({
        type: "error",
        error: err instanceof Error ? err.message : "Unknown error occurred",
      });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  const handleAgentSelect = async (selectedAgent: Agent) => {
    try {
      const response = await fetch(
        `/api/workflows/${currentTask.workflow_id}/tasks/${currentTask.workflow_task_id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...currentTask,
            agent_id: selectedAgent.id,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update task agent");
      }

      const updatedTask = {
        ...currentTask,
        agent_id: selectedAgent.id,
      };
      setCurrentTask(updatedTask);
      setAgent(selectedAgent);
      setIsAgentSelectOpen(false);
      onUpdate(updatedTask, selectedAgent);

      toast({
        title: "Agent assigned successfully",
      });
    } catch (error) {
      console.error("Error assigning agent:", error);
      toast({
        title: "Failed to assign agent",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-7xl">
          <TaskModalHeader
            task={currentTask}
            agent={agent}
            isLoading={isLoading || loadingAgents}
            onTest={handleTest}
            onChangeAgent={() => setIsAgentSelectOpen(true)}
          />

          <div className="grid grid-cols-3 gap-4 mt-4">
            <PreviousNodeOutputPanel
              data={previousNodeOutput || null}
              outputFormat={outputFormat}
              setOutputFormat={setOutputFormat}
            />

            {loadingAgents ? (
              <div className="border rounded-lg p-4 flex items-center justify-center">
                Loading agent information...
              </div>
            ) : !agent ? (
              <div className="border rounded-lg p-4 flex items-center justify-center">
                <Button
                  variant="outline"
                  onClick={() => setIsAgentSelectOpen(true)}
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign Agent
                </Button>
              </div>
            ) : (
              <TaskConfigurationPanel
                currentTask={currentTask}
                setCurrentTask={setCurrentTask}
                agent={agent}
              />
            )}

            <TestOutputPanel
              testOutput={testOutput}
              outputFormat={outputFormat}
              setOutputFormat={setOutputFormat}
              isStreaming={isStreaming}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AgentSelectModal
        isOpen={isAgentSelectOpen}
        onClose={() => setIsAgentSelectOpen(false)}
        onSelect={handleAgentSelect}
        agents={agents}
        loading={loadingAgents}
      />
    </>
  );
}
