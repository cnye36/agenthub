"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Edge, ReactFlowProvider } from "reactflow";
import { useRouter } from "next/navigation";
import {
  TaskType,
  WorkflowNode,
  TriggerNodeData,
  TaskNodeData,
  TriggerType,
} from "@/types/workflow";
import { createClient } from "@/supabase/client";
import { EmptyWorkflowState } from "./EmptyWorkflowState";
import { AgentSelectModal } from "./AgentSelectModal";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowHeader } from "./WorkflowHeader";
import { executeWorkflow } from "./WorkflowExecutionManager";
import { toast } from "@/hooks/use-toast";
import { TaskSidebar } from "./tasks/TaskSidebar";
import { Agent } from "@/types/agent";

interface WorkflowsBuilderProps {
  initialWorkflowId?: string;
}

interface WorkflowTrigger {
  trigger_id: string;
  name: string;
  description: string;
  trigger_type: TriggerType;
  workflow_id: string;
  config: Record<string, unknown>;
}

interface StoredWorkflowNode {
  id: string;
  type: "task";
  position: { x: number; y: number };
  data: {
    workflow_task_id: string;
    name: string;
    description: string;
    task_type: TaskType;
    workflow_id: string;
    config: {
      input: {
        source: string;
        parameters: Record<string, unknown>;
      };
      output: {
        destination: string;
      };
    };
  };
}

function WorkflowBuilder({ initialWorkflowId }: WorkflowsBuilderProps) {
  const router = useRouter();
  const supabase = createClient();

  const [workflowName, setWorkflowName] = useState("Undefined Workflow");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [workflowId, setWorkflowId] = useState<string | undefined>(
    initialWorkflowId
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [isTaskSidebarOpen, setIsTaskSidebarOpen] = useState(false);
  const [isAgentSelectOpen, setIsAgentSelectOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskForAgent, setSelectedTaskForAgent] = useState<
    string | null
  >(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<{
    name: string;
    description: string;
    task_type: TaskType;
  } | null>(null);
  const [isAgentSelectionLoading, setIsAgentSelectionLoading] = useState(false);

  const createdWorkflowRef = useRef(false);

  const handleAddTrigger = useCallback(async () => {
    if (!workflowId) {
      toast({
        title: "Cannot add trigger",
        description: "Workflow must be created first",
        variant: "destructive",
      });
      return;
    }

    try {
      // For MVP, we only support manual triggers
      const { data: newTrigger, error } = await supabase
        .from("workflow_triggers")
        .insert({
          workflow_id: workflowId,
          name: "Entrypoint",
          description: "Manually trigger this workflow",
          trigger_type: "manual",
        })
        .select()
        .single();

      if (error) throw error;

      const newNode: WorkflowNode = {
        id: `trigger-${newTrigger.trigger_id}`,
        type: "trigger" as const,
        position: { x: 100, y: 100 },
        data: {
          ...newTrigger,
          workflow_id: workflowId,
          hasConnectedTask: false,
          onOpenTaskSidebar: () => setIsTaskSidebarOpen(true),
        } as TriggerNodeData,
      };

      setNodes((nds) => [...nds, newNode]);

      toast({
        title: "Trigger added",
        description: "Click the plus button to add your first task",
        variant: "default",
      });
    } catch (err) {
      console.error("Error adding trigger:", err);
      toast({
        title: "Failed to add entrypoint",
        variant: "destructive",
      });
    }
  }, [workflowId]);

  const handleAssignAgent = useCallback((taskId: string) => {
    setSelectedTaskForAgent(taskId);
    setIsAgentSelectOpen(true);
  }, []);

  const handleConfigureTask = useCallback((taskId: string) => {
    setNodes((nds: WorkflowNode[]) =>
      nds.map((node: WorkflowNode) => {
        if (node.type === "task" && node.data.workflow_task_id === taskId) {
          return {
            ...node,
            data: {
              ...node.data,
              isConfigOpen: true,
              onConfigClose: () => {
                setSelectedTaskId(null);
                setNodes((prevNodes: WorkflowNode[]) =>
                  prevNodes.map((n: WorkflowNode) =>
                    n.type === "task" && n.data.workflow_task_id === taskId
                      ? { ...n, data: { ...n.data, isConfigOpen: false } }
                      : n
                  )
                );
              },
            },
          };
        }
        return node;
      })
    );
  }, []);

  const handleTaskConfigClose = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  // Add event listener for task updates
  useEffect(() => {
    const handleTaskUpdate = (
      event: CustomEvent<{
        taskId: string;
        updates: {
          name: string;
          description: string;
          type: TaskType;
          config: {
            input: {
              source: string;
              parameters: Record<string, unknown>;
              prompt?: string;
            };
            output: {
              destination: string;
            };
          };
        };
      }>
    ) => {
      setNodes((nds: WorkflowNode[]) =>
        nds.map((node: WorkflowNode) =>
          node.type === "task" &&
          node.data.workflow_task_id === event.detail.taskId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...event.detail.updates,
                  config: {
                    ...event.detail.updates.config,
                    input: {
                      ...event.detail.updates.config.input,
                      prompt: event.detail.updates.config.input.prompt || "",
                    },
                  },
                },
              }
            : node
        )
      );
    };

    window.addEventListener(
      "updateTaskNode",
      handleTaskUpdate as EventListener
    );
    return () => {
      window.removeEventListener(
        "updateTaskNode",
        handleTaskUpdate as EventListener
      );
    };
  }, []);

  // Create a new workflow immediately if we don't have an ID
  useEffect(() => {
    const initializeWorkflow = async () => {
      if (workflowId || initialWorkflowId || createdWorkflowRef.current) return;
      createdWorkflowRef.current = true;

      setLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.push("/auth/login");
          return;
        }

        // Create new empty workflow
        const { data: newWorkflow, error } = await supabase
          .from("workflows")
          .insert({
            name: workflowName,
            owner_id: user.id,
            nodes: [],
            edges: [],
            status: "draft",
            is_active: false,
          })
          .select()
          .single();

        if (error) throw error;

        // Set state without triggering navigation
        setWorkflowId(newWorkflow.workflow_id);
        setWorkflowName(newWorkflow.name);

        // Update URL without full navigation
        window.history.pushState(
          {},
          "",
          `/workflows/${newWorkflow.workflow_id}`
        );
      } catch (err) {
        console.error("Error creating workflow:", err);
        toast({
          title: "Failed to create workflow",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    initializeWorkflow();
  }, []);

  // Load existing workflow if ID is provided
  useEffect(() => {
    const loadWorkflow = async () => {
      if ((!workflowId && !initialWorkflowId) || loading) return;

      const idToLoad = workflowId || initialWorkflowId;
      setLoading(true);
      try {
        const [workflowResult, triggersResult, tasksResult] = await Promise.all([
          supabase
            .from("workflows")
            .select("*")
            .eq("workflow_id", idToLoad)
            .single(),
          supabase
            .from("workflow_triggers")
            .select("*")
            .eq("workflow_id", idToLoad),
          supabase
            .from("workflow_tasks")
            .select("*")
            .eq("workflow_id", idToLoad)
            .order("position"),
        ]);

        if (workflowResult.error) throw workflowResult.error;
        if (triggersResult.error) throw triggersResult.error;
        if (tasksResult.error) throw tasksResult.error;

        const workflow = workflowResult.data;
        const triggers = triggersResult.data as WorkflowTrigger[];
        const workflowTasks = tasksResult.data || [];

        if (workflow) {
          setWorkflowId(workflow.workflow_id);
          setWorkflowName(workflow.name);

          // Combine trigger nodes with task nodes
          const allNodes: WorkflowNode[] = [
            ...triggers.map((trigger: WorkflowTrigger) => ({
              id: `trigger-${trigger.trigger_id}`,
              type: "trigger" as const,
              position: { x: 100, y: 100 },
              data: {
                ...trigger,
                workflow_id: workflow.workflow_id,
                // Check if this trigger has any connected tasks based on edges
                hasConnectedTask:
                  Array.isArray(workflow.edges) &&
                  workflow.edges.some(
                    (edge: Edge) =>
                      edge.source === `trigger-${trigger.trigger_id}`
                  ),
                onOpenTaskSidebar: () => setIsTaskSidebarOpen(true),
              } as TriggerNodeData,
            })),
            ...workflowTasks.map((task: any) => ({
              id: `task-${task.workflow_task_id}`,
              type: "task" as const,
              position: { x: 300, y: 100 }, // Default position, you might want to store this in the database
              data: {
                workflow_task_id: task.workflow_task_id,
                workflow_id: workflow.workflow_id,
                name: task.name,
                description: task.description,
                task_type: task.task_type,
                config: task.config,
                assignedAgent: task.config?.assigned_agent,
                status: task.status || "idle",
                onAssignAgent: handleAssignAgent,
                onConfigureTask: handleConfigureTask,
                isConfigOpen: false,
                user_id: "",
              } as unknown as TaskNodeData,
            })),
          ];

          setNodes(allNodes);
          setEdges(workflow.edges);
        }
      } catch (err) {
        console.error("Error loading workflow:", err);
        toast({
          title: "Error loading workflow",
          variant: "destructive",
        });
        router.push("/workflows");
      } finally {
        setLoading(false);
        setLoadingAgents(false);
      }
    };

    loadWorkflow();
  }, [workflowId, initialWorkflowId, handleAssignAgent, handleConfigureTask]);

  // Load assistants
  useEffect(() => {
    const loadAssistants = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("User not authenticated");
        }

        interface UserAgent {
          agent: Agent;
        }

        const { data: agentsData, error } = await supabase
          .from("user_agents")
          .select(
            `
            agent:agent (*)
          `
          )
          .eq("user_id", user.id);

        if (error) throw error;

        // Extract just the agent data from the joined results
        setAgents(agentsData?.map((ua: UserAgent) => ua.agent) || []);
      } catch (err) {
        console.error("Error loading agents:", err);
        toast({
          title: "Failed to load agents",
          variant: "destructive",
        });
      } finally {
        setLoadingAgents(false);
      }
    };

    loadAssistants();
  }, [supabase]);

  // Set trigger as active when workflow is loaded
  useEffect(() => {
    if (nodes.length > 0 && !activeNodeId) {
      const triggerNode = nodes.find((n) => n.type === "trigger");
      if (triggerNode) {
        setActiveNodeId(triggerNode.id);
      }
    }
  }, [nodes, activeNodeId]);

  // Handle adding task from an existing task
  const handleAddTaskFromNode = useCallback(
    (sourceNodeId: string) => {
      setIsTaskSidebarOpen(true);
      // Store the source node ID to use when the task is created
      const sourceNode = nodes.find((n) => n.id === sourceNodeId);
      if (sourceNode) {
        setActiveNodeId(sourceNode.id);
      }
    },
    [nodes]
  );

  const handleSave = async () => {
    if (saving) return;

    if (!workflowName.trim()) {
      toast({
        title: "Please enter a workflow name",
        variant: "destructive",
      });
      return;
    }

    if (nodes.length === 0) {
      toast({
        title: "Workflow must contain at least one assistant.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const workflowData = {
        name: workflowName.trim(),
        nodes,
        edges,
        user_id: undefined,
      };

      if (workflowId) {
        const { data, error } = await supabase
          .from("workflows")
          .update(workflowData)
          .eq("workflow_id", workflowId)
          .select();

        if (error) throw error;

        if (data && data.length > 0) {
          toast({
            title: "Workflow updated successfully",
            variant: "default",
          });

          setNodes(
            data[0].nodes.map((node: WorkflowNode) => ({
              ...node,
              data: {
                ...node.data,
                workflowId,
                onAssignAgent: handleAssignAgent,
              },
            }))
          );
          setEdges(data[0].edges);
        }
      } else {
        const { data, error } = await supabase
          .from("workflows")
          .insert(workflowData)
          .select();

        if (error) throw error;

        if (data && data.length > 0) {
          const newWorkflowId = data[0].workflow_id;
          setWorkflowId(newWorkflowId);
          router.push(`/workflows/${newWorkflowId}`);

          toast({
            title: "Workflow saved successfully",
            variant: "default",
          });
        }
      }
    } catch (err) {
      console.error("Error saving workflow:", err);
      toast({
        title: "Failed to save workflow",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteWorkflow = async () => {
    if (!workflowId) {
      toast({
        title: "Workflow ID is missing",
        variant: "destructive",
      });
      return;
    }

    setIsExecuting(true);
    await executeWorkflow({
      workflowId,
      setNodes,
      setIsExecuting,
    });
  };

  const handleAgentSelect = async (agent: Agent) => {
    if (!workflowId) {
      toast({
        title: "Cannot assign agent",
        description: "Workflow must be selected",
        variant: "destructive",
      });
      return;
    }

    setIsAgentSelectionLoading(true);

    try {
      // Case 1: Creating a new task with an assigned agent
      if (selectedTaskForAgent === "pending" && pendingTask) {
        // Create the task with the selected assistant
        const taskPayload = {
          workflow_id: workflowId,
          name: pendingTask.name,
          description: pendingTask.description,
          task_type: pendingTask.task_type,
          agent_id: agent.id,
          agent_name: agent.name,
          agent_avatar: agent.agent_avatar,
        };

        const response = await fetch(`/api/workflows/${workflowId}/tasks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(taskPayload),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to create task");
        }

        const newTask = await response.json();

        const newNode: WorkflowNode = {
          id: `task-${newTask.workflow_task_id}`,
          type: "task" as const,
          position: { x: 300, y: 100 },
          data: {
            workflow_task_id: newTask.workflow_task_id,
            name: newTask.name,
            description: newTask.description || "",
            task_type: newTask.task_type,
            workflow_id: workflowId,
            assignedAgent: newTask.config?.assigned_agent || {
              id: agent.id,
              name: agent.name,
              avatar: agent.agent_avatar,
            },
            config: {
              input: {
                source: "previous_node",
                parameters: {},
                prompt: "",
              },
              output: {
                destination: "next_node",
              },
            },
            status: "idle",
            onAssignAgent: handleAssignAgent,
            onConfigureTask: handleConfigureTask,
            isConfigOpen: false,
            onConfigClose: () => {
              setSelectedTaskId(null);
              setNodes((prevNodes) =>
                prevNodes.map((n) =>
                  n.type === "task" &&
                  n.data.workflow_task_id === newTask.workflow_task_id
                    ? { ...n, data: { ...n.data, isConfigOpen: false } }
                    : n
                )
              );
            },
          } as unknown as TaskNodeData,
        };

        // Position the new node relative to the active node
        if (activeNodeId) {
          const sourceNode = nodes.find((n) => n.id === activeNodeId);
          if (sourceNode) {
            newNode.position = {
              x: sourceNode.position.x + 400,
              y: sourceNode.position.y,
            };

            // Create an edge from the source node to the new node
            const newEdge = {
              id: `edge-${sourceNode.id}-${newNode.id}`,
              source: sourceNode.id,
              target: newNode.id,
              type: "custom",
            };
            setEdges((eds) => [...eds, newEdge]);
          }
        }

        setNodes((nds) => [...nds, newNode]);
        setIsTaskSidebarOpen(false);
        setSelectedTaskId(newTask.workflow_task_id);
        setActiveNodeId(newNode.id);

        // Update the trigger node to indicate it has a connected task
        if (
          activeNodeId &&
          nodes.find((n) => n.id === activeNodeId)?.type === "trigger"
        ) {
          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id === activeNodeId && node.type === "trigger"
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      hasConnectedTask: true,
                    },
                  }
                : node
            )
          );
        }

        // Clean up
        setPendingTask(null);
        setIsAgentSelectOpen(false);
        setSelectedTaskForAgent(null);

        toast({
          title: "Task created with assigned agent",
          variant: "default",
        });
        setIsAgentSelectionLoading(false);
        return;
      }

      // Case 2: Updating an existing task with an assistant
      if (!selectedTaskForAgent || selectedTaskForAgent === "pending") {
        toast({
          title: "Cannot assign agent",
          description: "Task must be selected",
          variant: "destructive",
        });
        setIsAgentSelectionLoading(false);
        return;
      }

      // Update the task with the selected agent in the database
      const { error: updateError } = await supabase
        .from("workflow_tasks")
        .update({
          // Store agent ID in agent_id field for database queries
          agent_id: agent.id,
          // Store full agent details in config for UI
          config: {
            ...(await supabase
              .from("workflow_tasks")
              .select("config")
              .eq("workflow_task_id", selectedTaskForAgent)
              .single()
              .then(
                (result: { data: { config: Record<string, unknown> } }) =>
                  result.data?.config || {}
              )),
            assigned_agent: {
              id: agent.id,
              name: agent.name,
              avatar: agent.agent_avatar,
            },
          },
        })
        .eq("workflow_task_id", selectedTaskForAgent);

      if (updateError) throw updateError;

      // Update the node in the UI
      setNodes((nds) =>
        nds.map((node) => {
          if (
            node.type === "task" &&
            node.data.workflow_task_id === selectedTaskForAgent
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                assignedAgent: {
                  id: agent.id,
                  name: agent.name,
                  avatar: agent.agent_avatar,
                },
              },
            };
          }
          return node;
        })
      );

      setIsAgentSelectOpen(false);
      setSelectedTaskForAgent(null);

      toast({
        title: "Agent assigned to task",
        description: `${agent.name} has been assigned to this task`,
        variant: "default",
      });
    } catch (error) {
      console.error("Error assigning agent:", error);
      toast({
        title: "Failed to assign agent",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsAgentSelectionLoading(false);
    }
  };

  // Handle task selection
  const handleTaskSelect = async (taskOption: {
    type: TaskType;
    label: string;
    description: string;
  }) => {
    if (!workflowId) {
      toast({
        title: "Cannot create task without workflow",
        variant: "destructive",
      });
      return;
    }

    // Store the task details temporarily for all task types
    setSelectedTaskForAgent("pending");
    // Store these details in state to use later
    const pendingTaskDetails = {
      name: taskOption.label,
      description: taskOption.description,
      task_type: taskOption.type,
    };
    // Store in component state for later use
    setPendingTask(pendingTaskDetails);
    // Open the agent selection modal
    setIsAgentSelectOpen(true);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-lg">Loading workflow...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col relative">
      <WorkflowHeader
        workflowName={workflowName}
        setWorkflowName={setWorkflowName}
        onSave={handleSave}
        onExecute={handleExecuteWorkflow}
        onBack={() => router.push("/workflows")}
        saving={saving}
        executing={isExecuting}
        workflowId={workflowId}
      />
      <div className="flex-1 relative">
        <WorkflowCanvas
          nodes={nodes}
          setNodes={setNodes}
          edges={edges}
          setEdges={setEdges}
          initialWorkflowId={workflowId}
          selectedTaskId={selectedTaskId}
          onTaskConfigClose={handleTaskConfigClose}
          activeNodeId={activeNodeId}
          setActiveNodeId={setActiveNodeId}
          onAddTask={handleAddTaskFromNode}
        />
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <EmptyWorkflowState onAddTrigger={handleAddTrigger} />
            </div>
          </div>
        )}
        <TaskSidebar
          isOpen={isTaskSidebarOpen}
          onClose={() => {
            setIsTaskSidebarOpen(false);
          }}
          onTaskSelect={handleTaskSelect}
        />
      </div>
      <AgentSelectModal
        isOpen={isAgentSelectOpen}
        onClose={() => {
          setIsAgentSelectOpen(false);
          setSelectedTaskForAgent(null);
        }}
        onSelect={handleAgentSelect}
        agents={agents}
        loading={loadingAgents || isAgentSelectionLoading}
      />
    </div>
  );
}

export function WorkflowsBuilder(props: WorkflowsBuilderProps) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilder {...props} />
    </ReactFlowProvider>
  );
}
