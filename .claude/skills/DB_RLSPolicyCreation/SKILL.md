Description: Creates and enables Row-Level Security (RLS) policies for specified Supabase tables.

• Purpose: To enforce fine-grained access control, ensuring users only access authorized data.

• Inputs: tableName (string), policyName (string), policyDefinition (SQL string for USING and WITH CHECK clauses), operations (array of SELECT, INSERT, UPDATE, DELETE).

• Outputs: SQL script for RLS policy creation.

• Workflow:

1. Enable RLS for tableName.

2. Construct CREATE POLICY statement based on policyDefinition and operations.
