# Testing Pipeline (AI Suggestions A/B Testing)

## Overview

The testing pipeline tracks and stores AI suggestion results at each step of the generation process. This enables A/B testing of different suggestion algorithms, debugging of production issues, and validation of prompt changes by comparing outputs across test sets.

## Implementation

### Key Files
- `src/lib/services/testingPipeline.ts` - Core pipeline recording service

### Database Tables

| Table | Purpose |
|-------|---------|
| `testing_edits_pipeline` | Stores pipeline step outputs for analysis |

### Record Structure

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Auto-generated primary key |
| `set_name` | string | Test set identifier (e.g., "v1_prompt_changes") |
| `step` | string | Pipeline step name (e.g., "initial_prompt", "llm_response") |
| `content` | string | The actual output at this step |
| `session_id` | string? | Optional session identifier |
| `explanation_id` | number? | Associated explanation ID |
| `explanation_title` | string? | Explanation title for reference |
| `user_prompt` | string? | Original user prompt |
| `source_content` | string? | Source content being edited |
| `session_metadata` | object? | Additional session context |
| `created_at` | timestamp | Auto-generated |

### Processing Flow

```
AI Suggestion Request
        ↓
checkAndSaveTestingPipelineRecord("test-set", "step-1", content)
        ↓
  [Check if exact match exists]
        ↓
    No → saveTestingPipelineRecordImpl() → testing_edits_pipeline table
   Yes → Skip (deduplication)
```

## Usage

### Recording Pipeline Steps

```typescript
import { checkAndSaveTestingPipelineRecord } from '@/lib/services/testingPipeline';

// Record a step in the pipeline (with deduplication)
const result = await checkAndSaveTestingPipelineRecord(
  'experiment-v2',        // set_name
  'initial_prompt',       // step
  promptContent,          // content
  {                       // optional session data
    session_id: sessionId,
    explanation_id: explanationId,
    explanation_title: title,
    user_prompt: userPrompt,
    source_content: sourceText
  }
);

if (result.saved) {
  console.log('New record saved:', result.record.id);
} else {
  console.log('Duplicate detected, skipped');
}
```

### Checking for Existing Records

```typescript
import { checkTestingPipelineExists } from '@/lib/services/testingPipeline';

// Check if exact match already exists
const exists = await checkTestingPipelineExists(
  'experiment-v2',
  'initial_prompt',
  promptContent
);
```

### Retrieving Test Set Records

```typescript
import { getTestingPipelineRecords } from '@/lib/services/testingPipeline';

// Get all records for a test set (ordered by creation time)
const records = await getTestingPipelineRecords('experiment-v2');

// Analyze progression through pipeline steps
for (const record of records) {
  console.log(`Step: ${record.step}`);
  console.log(`Content length: ${record.content.length}`);
}
```

### Renaming Test Sets

```typescript
import { updateTestingPipelineRecordSetName } from '@/lib/services/testingPipeline';

// Rename a specific record's set
await updateTestingPipelineRecordSetName(recordId, 'experiment-v2-final');
```

## Common Use Cases

### A/B Testing Prompts

```typescript
// Record outputs from different prompt versions
await checkAndSaveTestingPipelineRecord(
  'prompt-test-jan2026',
  'v1_prompt_response',
  responseFromV1
);

await checkAndSaveTestingPipelineRecord(
  'prompt-test-jan2026',
  'v2_prompt_response',
  responseFromV2
);

// Later: compare responses in the database
```

### Debugging Production Issues

```typescript
// Record each step when debugging
await checkAndSaveTestingPipelineRecord(
  `debug-${explanationId}`,
  'raw_input',
  JSON.stringify({ prompt, source })
);

await checkAndSaveTestingPipelineRecord(
  `debug-${explanationId}`,
  'llm_response',
  llmOutput
);

await checkAndSaveTestingPipelineRecord(
  `debug-${explanationId}`,
  'parsed_suggestions',
  JSON.stringify(suggestions)
);
```

## Best Practices

1. **Meaningful set names**: Use descriptive names like `prompt-experiment-2026-01` not `test1`
2. **Consistent step names**: Standardize step names across experiments for easier comparison
3. **Deduplication**: Use `checkAndSaveTestingPipelineRecord` to avoid duplicate entries
4. **Session context**: Include session data when tracking user-initiated flows
5. **Content serialization**: JSON-stringify complex objects for consistent storage

## Automatic Logging

All functions are wrapped with `withLogging` for automatic:
- Entry/exit logging with timing
- Error capture and logging
- Debug visibility in server logs
