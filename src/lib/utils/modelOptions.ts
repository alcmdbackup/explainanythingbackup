// Shared MODEL_OPTIONS derived from the allowedLLMModelSchema source of truth.
// All UI model selectors should import from here to stay in sync.

import { allowedLLMModelSchema } from '@/lib/schemas/schemas';

export const MODEL_OPTIONS: readonly string[] = allowedLLMModelSchema.options;
