# Real-time Streaming

## Overview

Real-time streaming delivers AI-generated content incrementally to the editor using Server-Sent Events (SSE). This provides immediate feedback during generation while managing editor state to prevent conflicts.

## Implementation

### Key Files
- `src/app/api/stream-chat/route.ts` - SSE API endpoint for chat
- `src/app/api/returnExplanation/route.ts` - SSE API endpoint for explanation generation
- `src/hooks/useStreamingEditor.ts` - Editor state management
- `src/lib/webVitals.ts` - Performance tracking for streams

### Streaming Architecture

```
Client Request → API Route → OpenAI Streaming → SSE Response → Editor Update
                    ↓
            RequestIdContext.run()
                    ↓
            ReadableStream with callbacks
                    ↓
            Server heartbeat (30s) + Max timeout (5min)
```

### SSE Headers

Proper SSE implementation uses these headers:

```typescript
headers: {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',  // Disable nginx buffering
}
```

### API Response Format

SSE events use proper event types:

```typescript
// Content chunks
event: message
data: {"text":"...","isComplete":false}

// Completion event
event: complete
data: {"text":"","isComplete":true}

// Error event
event: error
data: {"error":"...","isComplete":true}

// Server heartbeat (every 30s)
event: heartbeat
data: {"timestamp":"2026-01-18T...","elapsed":30}
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

## Resilience

### Server-Side Timeouts

The streaming API includes built-in resilience:

- **Heartbeat**: Server sends `event: heartbeat` every 30 seconds to keep the connection alive
- **Maximum timeout**: 5-minute limit prevents indefinite streams
- **Timeout error**: Sends `event: error` with timeout message when limit is reached

```typescript
// Server heartbeat implementation (returnExplanation route)
const heartbeatInterval = setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  controller.enqueue(
    encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), elapsed })}\n\n`)
  );
}, 30000);
```

### Client-Side Timeout Detection

Clients should implement timeout detection:

```typescript
// 60-second timeout if no data received
let clientTimeout: NodeJS.Timeout;

const resetClientTimeout = () => {
  clearTimeout(clientTimeout);
  clientTimeout = setTimeout(() => {
    setError('No response from server');
    reader.cancel();
  }, 60000);
};

// Reset on each event (including heartbeats)
reader.onmessage = (event) => {
  resetClientTimeout();
  // Process event...
};
```

## Performance Tracking

Streaming performance is tracked using Web Vitals:

```typescript
import { markPerformance, measurePerformance } from '@/lib/webVitals';

// Mark streaming start
markPerformance('streaming_start', { userInput });

// ... streaming happens ...

// Mark completion and measure duration
markPerformance('content_complete', { contentLength });
const duration = measurePerformance('streaming_duration', 'streaming_start', 'content_complete');
```

These measurements are reported to Sentry for monitoring streaming performance in production.
