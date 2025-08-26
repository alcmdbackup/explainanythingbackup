import { z } from 'zod';

/**
 * Enum for change operation types in text editing
 * • Insert: Add new text at a specific position
 * • Delete: Remove text from a specific range
 * • Replace: Replace text in a specific range with new content
 * 
 * Used by: Text editing components for patch operations
 * Calls: None (enum definition)
 */
export enum ChangeKind {
  Insert = "insert",
  Delete = "delete", 
  Replace = "replace"
}

/**
 * Schema for validating change operation types
 * • Restricts change kind to valid editing operations only
 * • Ensures consistent change type usage across the application
 * • Provides type safety for text editing operations
 * Used by: Text editing components for parameter validation
 * Calls: N/A (validation schema)
 */
export const changeKindSchema = z.nativeEnum(ChangeKind);

export type ChangeKindType = z.infer<typeof changeKindSchema>;

/**
 * Schema for text patch changes with grapheme-safe positioning
 * • Defines atomic text editing operations with precise positioning
 * • Uses grapheme-based coordinates for Unicode-safe text manipulation
 * • Supports optional node-level targeting for structured editors
 * • Includes contextual information for UI display
 * 
 * @example
 * {
 *   id: "patch-123",
 *   kind: "insert",
 *   startG: 15,
 *   endG: 15,
 *   newText: "enhances sleep quality",
 *   nodeKey: "heading-2",
 *   hunkLabel: "## Benefits of Exercise",
 *   summary: "Add 'enhances sleep quality'"
 * }
 * 
 * Used by: Text editing components for applying changes
 * Calls: None (data structure)
 */
export const patchChangeSchema = z.object({
  id: z.string(),
  kind: changeKindSchema,
  // Grapheme-safe ranges in the ORIGINAL text
  startG: z.number().int().min(0),
  endG: z.number().int().min(0),
  // Replacement text for insert/replace operations
  newText: z.string().optional(),
  // Optional: node-level targeting (after mapping to Markdown/Lexical)
  nodeKey: z.string().optional(),
  // Hunk context for sidebar display
  hunkLabel: z.string().optional(),   // e.g., "## Benefits of Exercise"
  summary: z.string().optional(),     // e.g., "Add 'enhances sleep quality'"
}).refine(
  (data) => {
    // Validate that startG is less than or equal to endG
    return data.startG <= data.endG;
  },
  {
    message: "startG must be less than or equal to endG",
    path: ["startG", "endG"]
  }
).refine(
  (data) => {
    // Validate that newText is provided for insert/replace operations
    if (data.kind === ChangeKind.Insert || data.kind === ChangeKind.Replace) {
      return data.newText !== undefined;
    }
    return true;
  },
  {
    message: "newText is required for insert and replace operations",
    path: ["newText"]
  }
);

// Derive types from schemas
export type PatchChangeType = z.infer<typeof patchChangeSchema>;

/**
 * Response schema for LLM edit suggestions
 * • Wraps patchChangeSchema array for structured output
 * • Used by: callOpenAIModel for structured output validation
 * • Calls: patchChangeSchema for individual patch validation
 */
export const editorSuggestionResponseSchema = z.object({
    patches: z.array(patchChangeSchema).describe("Array of patch changes to apply to the content")
});
