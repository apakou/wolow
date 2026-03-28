Description: Generates and applies SQL migration scripts to modify the Supabase database schema.

• Purpose: To adapt the database structure for new features (e.g., E2EE message storage, group chats).

• Inputs: tableName (string), changes (JSON object describing column additions/modifications).

• Outputs: SQL migration script (string).

• Workflow:

1. Analyze changes to determine necessary ALTER TABLE or CREATE TABLE statements.

2. Generate a Supabase-compatible SQL script.
