-- Migration to update workflow_tasks table to use agents instead of assistants

-- First, drop the foreign key constraint to the old assistants table
ALTER TABLE workflow_tasks 
DROP CONSTRAINT IF EXISTS workflow_tasks_assistant_id_fkey;

-- Rename the assistant_id column to agent_id 
ALTER TABLE workflow_tasks 
RENAME COLUMN assistant_id TO agent_id;

-- Add foreign key constraint to the new agent table
-- Note: agent table uses 'id' as primary key, not 'agent_id'
ALTER TABLE workflow_tasks 
ADD CONSTRAINT workflow_tasks_agent_id_fkey 
FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE SET NULL;

-- Update any existing indexes
DROP INDEX IF EXISTS idx_workflow_tasks_assistant_id;
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_agent_id ON workflow_tasks(agent_id);

-- Update RLS policies that might reference the old column
DO $$ BEGIN
    -- Drop existing policies
    DROP POLICY IF EXISTS "Users can view tasks with their assistants" ON workflow_tasks;
    DROP POLICY IF EXISTS "Users can create tasks with their assistants" ON workflow_tasks;
    DROP POLICY IF EXISTS "Users can update tasks with their assistants" ON workflow_tasks;
    DROP POLICY IF EXISTS "Users can delete tasks with their assistants" ON workflow_tasks;
    
    -- The existing workflow-based policies should still work, but let's make sure they exist
    -- These policies are based on workflow ownership, which is safer
    
    CREATE POLICY "Users can view tasks in their workflows"
        ON workflow_tasks FOR SELECT
        USING (EXISTS (
            SELECT 1 FROM workflows
            WHERE workflows.workflow_id = workflow_tasks.workflow_id
            AND workflows.owner_id = auth.uid()
        ));

    CREATE POLICY "Users can create tasks in their workflows"
        ON workflow_tasks FOR INSERT
        WITH CHECK (EXISTS (
            SELECT 1 FROM workflows
            WHERE workflows.workflow_id = workflow_tasks.workflow_id
            AND workflows.owner_id = auth.uid()
        ));

    CREATE POLICY "Users can update tasks in their workflows"
        ON workflow_tasks FOR UPDATE
        USING (EXISTS (
            SELECT 1 FROM workflows
            WHERE workflows.workflow_id = workflow_tasks.workflow_id
            AND workflows.owner_id = auth.uid()
        ));

    CREATE POLICY "Users can delete tasks in their workflows"
        ON workflow_tasks FOR DELETE
        USING (EXISTS (
            SELECT 1 FROM workflows
            WHERE workflows.workflow_id = workflow_tasks.workflow_id
            AND workflows.owner_id = auth.uid()
        ));
        
EXCEPTION WHEN OTHERS THEN
    -- Policies might already exist, continue
    NULL;
END $$; 