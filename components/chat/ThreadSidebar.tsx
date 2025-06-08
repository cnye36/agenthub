import { useEffect, useCallback, useState } from "react";
import {
  PlusCircle,
  MessageSquare,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Thread {
  thread_id: string;
  created_at: string;
  metadata: {
    user_id: string;
    agent_id: string;
    title?: string;
  };
}

interface ThreadSidebarProps {
  agentId: string;
  currentThreadId?: string;
  onThreadSelect: (threadId: string) => void;
  onNewThread: () => void;
}

export default function ThreadSidebar({
  agentId,
  currentThreadId,
  onThreadSelect,
  onNewThread,
}: ThreadSidebarProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [threadToRename, setThreadToRename] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const fetchThreads = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/threads`);
      if (!response.ok) throw new Error("Failed to fetch threads");
      const data = await response.json();
      const validThreads = Array.isArray(data.threads)
        ? data.threads.filter(
            (thread: Thread) =>
              thread &&
              thread.thread_id &&
              thread.metadata?.agent_id === agentId
          )
        : [];
      setThreads(validThreads);
    } catch (error) {
      console.error("Error fetching threads:", error);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  // Initial fetch and when currentThreadId changes
  useEffect(() => {
    fetchThreads();
  }, [fetchThreads, currentThreadId]);

  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
  };

  const handleRename = async (threadId: string) => {
    const thread = threads.find((t) => t.thread_id === threadId);
    setThreadToRename(threadId);
    setNewTitle(thread?.metadata?.title || "");
    setIsRenaming(true);
  };

  const handleSaveRename = async () => {
    if (!threadToRename || !newTitle.trim()) return;

    try {
      const response = await fetch(
        `/api/agents/${agentId}/threads/${threadToRename}/rename`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle.trim() }),
        }
      );

      if (!response.ok) throw new Error("Failed to rename thread");

      setThreads((prevThreads) =>
        prevThreads.map((thread) =>
          thread.thread_id === threadToRename
            ? {
                ...thread,
                metadata: {
                  ...thread.metadata,
                  title: newTitle.trim(),
                },
              }
            : thread
        )
      );
    } catch (error) {
      console.error("Error renaming thread:", error);
    } finally {
      setIsRenaming(false);
      setThreadToRename(null);
      setNewTitle("");
    }
  };

  const handleDelete = async (threadId: string) => {
    if (!confirm("Are you sure you want to delete this thread?")) return;

    try {
      const response = await fetch(
        `/api/agents/${agentId}/threads/${threadId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete thread");

      setThreads((prevThreads) =>
        prevThreads.filter((t) => t.thread_id !== threadId)
      );
      if (currentThreadId === threadId) {
        onNewThread();
      }
    } catch (error) {
      console.error("Error deleting thread:", error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-2 sm:p-4 border-b">
        <button
          onClick={onNewThread}
          className="w-full py-2 px-3 sm:px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors text-sm sm:text-base"
        >
          <PlusCircle className="h-4 w-4 sm:h-5 sm:w-5" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span>Loading chats...</span>
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-6 px-2">
            <MessageSquare className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No chats yet</p>
            <p className="text-xs text-muted-foreground/70">
              Start a new conversation
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {threads.map((thread) => (
              <div
                key={`thread-${thread.thread_id}`}
                className={`group flex items-center w-full rounded-lg transition-colors ${
                  currentThreadId === thread.thread_id
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                }`}
              >
                <button
                  onClick={() => onThreadSelect(thread.thread_id)}
                  className="flex-1 px-2 py-1.5 text-left min-w-0"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate text-sm">
                      {thread.metadata?.title ||
                        `Chat ${formatDate(thread.created_at)}`}
                    </span>
                  </div>
                </button>
                <div className="flex-shrink-0 px-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent/50">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[160px]">
                      <DropdownMenuItem
                        onClick={() => handleRename(thread.thread_id)}
                        className="text-sm"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive text-sm"
                        onClick={() => handleDelete(thread.thread_id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full text-sm"
              placeholder="Enter chat title"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRenaming(false)}
              className="text-sm"
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRename} className="text-sm">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

