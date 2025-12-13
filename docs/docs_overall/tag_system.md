# Tag System Documentation

## Overview

The tag system provides intelligent content categorization and filtering capabilities, combining AI-powered automatic tagging with interactive user management.

## Key Features

### 🤖 **AI-Powered Automatic Tagging**
- GPT-4 automatically evaluates explanations and assigns relevant tags
- Evaluates difficulty level, content length, and teaching characteristics

### 🏷️ **Dual Tag Architecture**
- **Simple Tags**: Individual characteristics (e.g., "has_example", "sequential")
- **Preset Collections**: Mutually exclusive categories (e.g., difficulty levels, content length)

### 🎯 **Interactive Management**
- Real-time tag editing with immediate visual feedback
- Validation to prevent conflicting tag assignments

## Tag Types

### Simple Tags
Individual characteristics that can be applied independently:
- **Teaching Methods**: `has_example`, `sequential`, `has_metaphor`, `instructional`
- **Content Characteristics**: Subject-specific tags, complexity indicators

### Preset Tag Collections
Mutually exclusive groups where only one tag can be active:

#### Difficulty Levels
- **Beginner (1)**: Basic concepts, minimal prerequisites, simple language
- **Normal (2)**: Moderate complexity, some background knowledge helpful
- **Expert (3)**: Advanced concepts, significant prerequisites, technical language

#### Content Length
- **Short (4)**: Brief overview, key points only, under 500 words
- **Medium (5)**: Standard explanation, balanced detail, 500-1500 words
- **Long (6)**: Comprehensive coverage, extensive detail, over 1500 words

## AI Tag Evaluation

### Evaluation Process
1. **Content Analysis**: GPT-4 analyzes explanation title and content
2. **Structured Assessment**: Evaluates difficulty, length, and teaching characteristics
3. **Tag Assignment**: Automatically assigns appropriate tags based on analysis

### Evaluation Criteria
- **Difficulty**: Beginner, Normal, Expert based on complexity and prerequisites
- **Length**: Short, Medium, Long based on word count and detail level
- **Teaching Methods**: Detects examples, sequential content, metaphors, instructions

## Frontend Implementation

### TagBar Component
The primary interface for tag management with:
- Visual tag display as colored chips
- Interactive editing with real-time validation
- Preset dropdowns for tag collections
- Modification tracking with apply/reset functionality

### Usage
```tsx
<TagBar 
  tags={tags} 
  setTags={setTags}
  explanationId={explanationId}
  onTagClick={(tag) => console.log('Tag clicked:', tag)}
/>
```

## Backend Services

### Core Services
- **`tags.ts`**: CRUD operations for individual tags
- **`explanationTags.ts`**: Manages explanation-tag relationships
- **`tagEvaluation.ts`**: Handles AI-powered tag evaluation

### Key Functions
```typescript
// Add/remove tags from explanation
await addTagsToExplanation(explanationId, tagIds);
await removeTagsFromExplanation(explanationId, tagIds);

// Get tags for explanation
const tags = await getTagsForExplanation(explanationId);

// AI evaluation
const evaluation = await evaluateTags(title, content, userid);
```

## Data Flow

### User Tagging Flow
1. User modifies tags via TagBar
2. Frontend validates tag combinations
3. Server action processes changes
4. Database updated via explanation_tags table
5. UI reflects new state

### AI Tagging Flow
1. New explanation created
2. GPT-4 analyzes content characteristics
3. Appropriate tags automatically assigned
4. Tags stored in database
5. Displayed in TagBar component

## Validation Rules

### Preset Tag Constraints
- Only one tag per preset collection can be active per explanation
- Conflicting preset tags result in validation error

### Simple Tag Rules
- Multiple simple tags can be active simultaneously
- No restrictions on simple tag combinations

## Error Handling
- **Validation Errors**: Invalid tag combinations or data
- **Database Errors**: Connection issues or constraint violations
- **AI Evaluation Errors**: GPT-4 API failures or invalid responses
- **Recovery**: Rollback operations and state restoration

## Performance Considerations
- **Database**: Indexed queries and batch operations
- **Frontend**: Debounced updates and optimistic UI feedback
- **Caching**: Memoized tag data to reduce redundant fetches

## Related Documentation
- **Architecture Overview**: See `architecture.md` for system-wide patterns
- **Product Overview**: See `product_overview.md` for user-facing features
