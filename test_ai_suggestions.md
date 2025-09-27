# Testing AI Suggestions Database Integration

## Why the table is empty

The `testing_edits_pipeline` table is empty because:

1. **The table structure needs to be updated** - The new session columns may not exist yet
2. **No AI suggestion sessions have been created** - Data is only created when you use the AI suggestions feature
3. **The table may not exist at all** - It needs to be created first

## Setup Steps

### 1. Create/Update the Database Table

Go to your Supabase dashboard → SQL Editor and run the script in `setup_testing_pipeline_table.sql`:

```sql
-- This will create the table with all required columns
-- and insert a sample record for testing
```

### 2. Verify Table Structure

After running the setup script, you should see:
- The `testing_edits_pipeline` table with all columns
- A sample record to verify everything works
- All required indexes

### 3. Test the AI Suggestions Feature

To create real AI suggestion sessions:

1. **Navigate to a results page** with an explanation:
   ```
   http://localhost:3001/results?explanation_id=123
   ```

2. **Use the AI Suggestions Panel** (when available on results page):
   - Enter a prompt like "Make this content more engaging"
   - Click "Get AI Suggestions"
   - Wait for the 4-step pipeline to complete

3. **Check the database** - You should now see 4 new records:
   - `step1_ai_suggestions` - The AI suggestions
   - `step2_applied_edits` - Content with edits applied
   - `step3_critic_markup` - Diff markup
   - `step4_preprocessed` - Final preprocessed content

4. **Click "Debug in EditorTest"** - This will take you to:
   ```
   http://localhost:3001/editorTest?explanation_id=123&session_id=uuid
   ```

### 4. Test the EditorTest Session Loading

1. **Navigate to EditorTest directly**:
   ```
   http://localhost:3001/editorTest
   ```

2. **Look for the session dropdown** - Should appear when sessions exist

3. **Load a session** - Select from dropdown to see all 4 pipeline steps loaded

## Expected Database Records

Each AI suggestion session creates 4 records with the same `session_id`:

| step | content_type | session_id |
|------|-------------|------------|
| step1_ai_suggestions | AI suggestions JSON | same-uuid |
| step2_applied_edits | Markdown with edits | same-uuid |
| step3_critic_markup | CriticMarkup diff | same-uuid |
| step4_preprocessed | Final preprocessed | same-uuid |

## Troubleshooting

### If you still don't see data:

1. **Check the browser console** for any errors
2. **Check the server logs** for database errors
3. **Verify the AI suggestions panel** is properly integrated on the results page
4. **Make sure the explanation_id exists** in your explanations table

### If the table doesn't exist:

1. Run the `setup_testing_pipeline_table.sql` script in Supabase
2. Check that your database connection is working
3. Verify you have the correct database permissions

## Current Implementation Status

✅ **Backend**: All server actions implemented
✅ **Frontend**: AI suggestions panel and EditorTest page updated
✅ **Database**: Schema designed and migration scripts created
🔄 **Testing**: Requires manual testing to create data

The table will populate once you start using the AI suggestions feature!