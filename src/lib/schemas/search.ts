import { z } from 'zod';

/**
 * Schema for validating search data
 * @example
 * {
 *   userQuery: "How does photosynthesis work?",
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const searchSchema = z.object({
    title: z.string(),
    content: z.string(),
    userQuery: z.string()
});

export type SearchInput = z.infer<typeof searchSchema>;