# Real-time Streaming

## Overview

Real-time streaming delivers AI-generated content incrementally to the editor using Server-Sent Events (SSE). This provides immediate feedback during generation while managing editor state to prevent conflicts.

## Implementation

### Key Files
- `src/app/api/stream-chat/route.ts` - SSE API endpoint
- `src/hooks/useStreamingEditor.ts` - Editor state management

### Streaming Architecture

```
Client Request → API Route → OpenAI Streaming → SSE Response → Editor Update
                    ↓
            RequestIdContext.run()
                    ↓
            ReadableStream with callbacks
```

### API Response Format

```typescript
// Success chunks
data: {"text":"...","isComplete":false}\n\n

// Final chunk
data: {"text":"","isComplete":true}\n\n

// Error
data: {"error":"...","isComplete":true}\n\n
```

### Editor Hook Behavior

| State | Editor Mode | Update Strategy |
|-------|-------------|-----------------|
| Streaming | Read-only | Debounced (100ms) |
| Complete | Restored | Immediate |
| User Editing | Edit mode | No AI updates |

### Key Protections

1. **Mount Check**: Skip updates until after first render
2. **Edit Mode Check**: Don't overwrite user edits
3. **Initial Load Flag**: Prevents spurious callbacks
4. **Debouncing**: Reduces render frequency during streaming

## Usage

### API Endpoint

```typescript
// POST /api/stream-chat
const response = await fetch('/api/stream-chat', {
  method: 'POST',
  body: JSON.stringify({
    prompt: 'Explain quantum computing',
    userid: 'user-123',
    __requestId: 'req-456'  // For tracing
  })
});

// Read stream
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = JSON.parse(new TextDecoder().decode(value));
  if (chunk.text) appendContent(chunk.text);
  if (chunk.isComplete) break;
}
```

### Editor Hook

```typescript
import { useStreamingEditor } from '@/hooks/useStreamingEditor';

const { editorRef, handleContentChange } = useStreamingEditor({
  initialContent: '',
  isStreaming: true,
  isEditMode: false,
  onContentChange: (content) => saveContent(content),
  setEditMode: (mode) => dispatch({ type: 'SET_EDIT_MODE', mode })
});

// Pass ref to LexicalEditor
<LexicalEditor ref={editorRef} ... />
```

### Streaming Callback Pattern

```typescript
// In returnExplanationLogic
const onStreamingText = (text: string) => {
  // Enqueue to SSE stream
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ text, isComplete: false })}\n\n`)
  );
};

await generateNewExplanation(
  titleResult,
  additionalRules,
  userInputType,
  userid,
  existingContent,
  onStreamingText  // Callback invoked per chunk
);
```

### Request ID Propagation

```typescript
// API route wraps entire logic in context
RequestIdContext.run(
  { requestId: body.__requestId, userId: body.userid },
  async () => {
    // All async operations inherit this context
    // Logs automatically include requestId
  }
);
```
