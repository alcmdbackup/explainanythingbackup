// Shared MODEL_OPTIONS derived from the central model registry.
// All UI model selectors should import from here to stay in sync.

import { getModelOptions } from '@/config/modelRegistry';

export const MODEL_OPTIONS: readonly { label: string; value: string }[] = getModelOptions();
