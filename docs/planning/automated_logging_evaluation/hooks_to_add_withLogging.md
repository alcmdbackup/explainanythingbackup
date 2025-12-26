# Using Claude Code Hooks to Auto-Wrap Functions with withLogging

## Overview

This document outlines an approach to automatically wrap server and client functions with `withLogging` using Claude Code's PostToolUse hooks. The hook triggers after Claude edits or writes code files, automatically transforming exported functions to include logging wrappers.

## Goal

Automatically add `withLogging` wrappers to functions when Claude writes or edits code, ensuring consistent logging coverage without manual intervention.

## Approach

Use a **PostToolUse hook** that:
1. Triggers after Claude uses `Edit` or `Write` tools on TypeScript files
2. Runs a Node.js script to parse and transform the modified file
3. Automatically adds `withLogging` wrappers to exported functions
4. Provides feedback to Claude about what was wrapped

## Implementation

### 1. Create Hook Script

**Location:** `~/.claude/hooks/auto-wrap-logging.js`

**Responsibilities:**
- Parse TypeScript files using AST parser (acorn/babel) or regex patterns
- Detect exported functions that aren't already wrapped with `withLogging`
- Apply appropriate wrapper pattern
- Add import statements if missing
- Preserve type signatures, async/sync patterns, and function names

**Function Patterns to Handle:**

Pattern 1 - Direct export with withLogging:
```typescript
export const functionName = withLogging(
    async function functionName(params) {
        // function body
    },
    'functionName',
    { enabled: FILE_DEBUG }
);
```

Pattern 2 - Wrapped then re-exported (for functions needing `serverReadRequestId`):
```typescript
const _functionName = withLogging(
    async function functionName(params) {
        // function body
    },
    'functionName',
    { enabled: FILE_DEBUG }
);
export const functionName = serverReadRequestId(_functionName);
```

### 2. Hook Configuration

**Location:** `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/auto-wrap-logging.js",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

### 3. Script Logic

**Input (via stdin):**
```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "...",
  "tool_name": "Edit" | "Write",
  "tool_input": {
    "file_path": "/path/to/file.ts",
    "old_string": "...",
    "new_string": "..."
  }
}
```

**Processing Steps:**

1. **Filter Files:**
   - Only process `.ts` and `.tsx` files
   - Skip test files (`*.test.ts`, `*.spec.ts`)
   - Skip `node_modules`, framework files
   - Only process server-side files:
     - Files with `'use server'` directive
     - Files in `/src/actions/`
     - Files in `/src/lib/services/`
     - API route handlers in `/src/app/api/*/route.ts`

2. **Parse and Transform:**
   - Read the modified file
   - Parse TypeScript AST or use regex to find:
     - `export const functionName = async function`
     - `export async function functionName`
     - `export function functionName`
   - Check if function is already wrapped with `withLogging`
   - If not wrapped, apply transformation:
     - Add `withLogging` wrapper
     - Add function name as second parameter
     - Add config object: `{ enabled: FILE_DEBUG }`
     - Preserve all type annotations, async keywords, parameters

3. **Add Import:**
   - Check if `withLogging` is already imported
   - If not, add: `import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';`
   - For files needing `FILE_DEBUG`, add: `const FILE_DEBUG = true;` at top

4. **Handle Special Cases:**
   - Functions already wrapped with `serverReadRequestId`: Use Pattern 2
   - Functions with complex generics: Preserve type parameters
   - Arrow functions vs function declarations
   - Named exports vs default exports

**Output:**
- Exit code 0 with stdout message (shown to Claude in transcript):
  ```
  ✓ Auto-wrapped 3 functions with withLogging: saveExplanation, updateTags, deleteQuery
  ```
- Exit code 0 silently if no changes needed
- Exit code 2 with stderr if parsing fails (non-blocking error)

### 4. Example Script Implementation

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Read stdin
let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData);
    processFile(input);
  } catch (error) {
    console.error('Failed to parse input:', error.message);
    process.exit(0); // Non-blocking
  }
});

function processFile(input) {
  const { tool_input, cwd } = input;
  const filePath = tool_input.file_path;

  // Filter: only TypeScript files
  if (!filePath.match(/\.(ts|tsx)$/)) {
    process.exit(0);
  }

  // Filter: skip test files
  if (filePath.match(/\.(test|spec)\.(ts|tsx)$/)) {
    process.exit(0);
  }

  // Filter: skip node_modules
  if (filePath.includes('node_modules')) {
    process.exit(0);
  }

  // Read file content
  const content = fs.readFileSync(filePath, 'utf-8');

  // Filter: only server files
  const isServerFile = content.includes("'use server'") ||
                       filePath.includes('/src/actions/') ||
                       filePath.includes('/src/lib/services/') ||
                       filePath.match(/\/src\/app\/api\/.*\/route\.ts$/);

  if (!isServerFile) {
    process.exit(0);
  }

  // Transform: wrap functions
  const { transformed, wrappedFunctions } = wrapFunctionsWithLogging(content, filePath);

  if (wrappedFunctions.length === 0) {
    process.exit(0); // No changes needed
  }

  // Write back
  fs.writeFileSync(filePath, transformed, 'utf-8');

  // Report success
  console.log(`✓ Auto-wrapped ${wrappedFunctions.length} functions with withLogging: ${wrappedFunctions.join(', ')}`);
  process.exit(0);
}

function wrapFunctionsWithLogging(content, filePath) {
  // TODO: Implement AST-based transformation or robust regex
  // This is a simplified example

  let transformed = content;
  const wrappedFunctions = [];

  // Example regex for simple case (needs to be more robust)
  const exportFunctionRegex = /export\s+const\s+(\w+)\s*=\s*(async\s+)?function\s+\w*\s*\([^)]*\)\s*{/g;

  let match;
  while ((match = exportFunctionRegex.exec(content)) !== null) {
    const functionName = match[1];

    // Check if already wrapped
    if (content.includes(`withLogging(`) &&
        content.includes(`'${functionName}'`)) {
      continue; // Already wrapped
    }

    // Apply transformation (simplified - needs proper AST handling)
    // ... transformation logic ...

    wrappedFunctions.push(functionName);
  }

  // Add imports if needed
  if (wrappedFunctions.length > 0 && !content.includes('withLogging')) {
    const importStatement = `import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';\n`;
    transformed = importStatement + transformed;
  }

  return { transformed, wrappedFunctions };
}
```

## Testing Strategy

1. **Unit Tests:**
   - Test parsing of various function signatures
   - Verify no double-wrapping occurs
   - Check import statement injection
   - Test with already-wrapped functions

2. **Integration Tests:**
   - Create sample files with unwrapped functions
   - Run Claude Code to edit them
   - Verify hook triggers and transforms correctly
   - Check that Claude receives feedback

3. **Edge Cases:**
   - Functions with generics: `export const foo = <T>(param: T) => {...}`
   - Function overloads
   - Re-exported functions: `export { foo } from './other'`
   - Default exports
   - Arrow functions vs function declarations
   - Functions already wrapped with other wrappers

## Alternatives Considered

### 1. PreToolUse Hook
**Approach:** Modify Claude's tool input before execution

**Pros:**
- Could inject logging code before file is written
- Preview changes before they happen

**Cons:**
- Much harder to parse intended edits from tool input
- Would need to modify `old_string`/`new_string` on the fly
- Complex for partial edits

### 2. Build-Time Transformation
**Approach:** Use Babel plugin or TypeScript transformer

**Pros:**
- More robust AST manipulation
- Works with complex TypeScript syntax
- Integrated with build pipeline

**Cons:**
- Requires build configuration changes
- Only runs at build time, not when Claude edits
- May not align with "Claude hook" approach

### 3. Runtime-Only (Current System)
**Approach:** Module interceptor at runtime (already implemented)

**Pros:**
- Already working in codebase
- No file modifications needed
- Handles all function patterns

**Cons:**
- No explicit code showing logging
- Harder to debug/understand what's wrapped
- May miss some edge cases

## Trade-offs

### Pros
- **Automatic:** Zero manual effort to add wrappers
- **Explicit:** Creates readable code with visible `withLogging` calls
- **Feedback:** Claude sees what was wrapped
- **Complementary:** Works alongside existing auto-logging system
- **Consistent:** Ensures uniform logging patterns

### Cons
- **Complexity:** TypeScript parsing is non-trivial
- **Formatting:** May conflict with Claude's code style
- **Edge Cases:** Need to handle generics, overloads, complex types
- **Performance:** Adds overhead to every Edit/Write operation
- **Maintenance:** Script needs updates as patterns evolve

## Recommended Next Steps

1. **Start Simple:**
   - Implement basic regex-based wrapping for simple function patterns
   - Test on a subset of files (e.g., only `/src/actions/`)

2. **Iterate:**
   - Add AST parsing with `@babel/parser` for robust handling
   - Expand to more complex patterns (generics, overloads)
   - Add client-side function handling

3. **Refine:**
   - Handle edge cases discovered in testing
   - Optimize performance for large files
   - Add configuration options (which files to process, logging level, etc.)

4. **Document:**
   - Add inline comments to hook script
   - Create troubleshooting guide
   - Document supported function patterns

## Integration with Existing System

This hook-based approach **complements** the existing automatic logging system:

- **Module Interceptor** (already in place): Catches functions at runtime, works for all code
- **Hook-Based Wrapping** (this approach): Creates explicit wrappers when Claude edits code
- **Manual Wrapping** (current practice): Can still be used for special cases

**Combined benefit:** Runtime coverage + explicit code + automation when Claude helps

## Configuration Options

Consider making the hook configurable via project settings:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/hooks/auto-wrap-logging.js",
            "timeout": 10000,
            "env": {
              "AUTO_WRAP_ENABLED": "true",
              "AUTO_WRAP_PATTERN": "server", // "server", "client", "all"
              "AUTO_WRAP_PATHS": "/src/actions/,/src/lib/services/"
            }
          }
        ]
      }
    ]
  }
}
```

## References

- Claude Code Hooks Documentation: https://code.claude.com/docs/en/hooks
- Existing Auto-Logging System: `/src/backend_explorations/automatic_server_logging.md`
- withLogging Implementation: `/src/lib/logging/server/automaticServerLoggingBase.ts`
- Client Logging Proposal: `/src/backend_explorations/automated_client_logging_approach_2.md`
