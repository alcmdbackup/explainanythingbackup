'use server';

import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { handleError, createValidationError, type ErrorResponse } from '@/lib/errorHandling';
import { detectSource, cleanupAndReformat, validateImportContent } from '@/lib/services/importArticle';
import { createTopic } from '@/lib/services/topics';
import { createExplanation } from '@/lib/services/explanations';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { evaluateTags } from '@/lib/services/tagEvaluation';
import { applyTagsToExplanation } from '@/lib/services/returnExplanation';
import { refreshExplanationMetrics } from '@/lib/services/metrics';
import { explanationInsertSchema, ExplanationStatus, type ImportSource } from '@/lib/schemas/schemas';

const FILE_DEBUG = true;
const CONTENT_FORMAT_TEMPLATE = '# {title}\n\n{content}';

/**
 * Response type for processImport action
 */
type ProcessImportResponse = {
    success: boolean;
    data: {
        title: string;
        content: string;
        detectedSource: ImportSource;
    } | null;
    error: ErrorResponse | null;
};

/**
 * Response type for publishImportedArticle action
 */
type PublishImportResponse = {
    success: boolean;
    explanationId: number | null;
    error: ErrorResponse | null;
};

/**
 * Processes imported content: validates, detects source, and reformats
 *
 * • Validates content length and format
 * • Detects AI source if not provided
 * • Calls LLM to clean up and reformat content
 * • Returns formatted title and content for preview
 *
 * Used by: ImportModal component
 * Calls: validateImportContent, detectSource, cleanupAndReformat
 */
const _processImport = withLogging(
    async function processImport(
        content: string,
        userId: string,
        providedSource?: ImportSource
    ): Promise<ProcessImportResponse> {
        try {
            // Validate content
            const validation = validateImportContent(content);
            if (!validation.isValid) {
                return {
                    success: false,
                    data: null,
                    error: createValidationError(validation.error || 'Invalid content')
                };
            }

            // Detect or use provided source
            const detectedSource = providedSource || detectSource(content);

            // Clean up and reformat via LLM
            const formatted = await cleanupAndReformat(content, detectedSource, userId);

            return {
                success: true,
                data: {
                    title: formatted.title,
                    content: formatted.content,
                    detectedSource
                },
                error: null
            };
        } catch (error) {
            return {
                success: false,
                data: null,
                error: handleError(error, 'processImport', { contentLength: content.length })
            };
        }
    },
    'processImport',
    { enabled: FILE_DEBUG }
);

export const processImport = serverReadRequestId(_processImport);

/**
 * Publishes an imported article to the database
 *
 * • Creates topic from title
 * • Creates explanation with source field
 * • Runs post-save pipeline:
 *   - Vector embeddings for search
 *   - Tag evaluation and application
 *   - Metrics initialization
 *
 * Used by: ImportPreview component
 * Calls: createTopic, createExplanation, processContentToStoreEmbedding, evaluateTags, applyTagsToExplanation, refreshExplanationMetrics
 */
const _publishImportedArticle = withLogging(
    async function publishImportedArticle(
        title: string,
        content: string,
        source: ImportSource,
        userId: string
    ): Promise<PublishImportResponse> {
        try {
            // Create or get existing topic
            const topic = await createTopic({
                topic_title: title
            });

            // Prepare explanation data
            const explanationData = {
                explanation_title: title,
                content: content,
                primary_topic_id: topic.id,
                status: ExplanationStatus.Published,
                source: source
            };

            // Validate with schema
            const validatedData = explanationInsertSchema.safeParse(explanationData);
            if (!validatedData.success) {
                return {
                    success: false,
                    explanationId: null,
                    error: createValidationError('Invalid explanation data format', validatedData.error)
                };
            }

            // Create explanation
            const savedExplanation = await createExplanation(validatedData.data);

            // Create embeddings for vector search
            const combinedContent = CONTENT_FORMAT_TEMPLATE
                .replace('{title}', title)
                .replace('{content}', content);
            await processContentToStoreEmbedding(combinedContent, savedExplanation.id, topic.id);

            // Evaluate and apply tags (async, non-blocking errors)
            try {
                const tagEvaluation = await evaluateTags(title, content, userId);
                if (!tagEvaluation.error) {
                    await applyTagsToExplanation(savedExplanation.id, tagEvaluation, userId);
                }
            } catch {
                // Tag evaluation failures shouldn't block publishing
            }

            // Initialize metrics
            try {
                await refreshExplanationMetrics({
                    explanationIds: [savedExplanation.id]
                });
            } catch {
                // Metrics failures shouldn't block publishing
            }

            return {
                success: true,
                explanationId: savedExplanation.id,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                explanationId: null,
                error: handleError(error, 'publishImportedArticle', { title, source })
            };
        }
    },
    'publishImportedArticle',
    { enabled: FILE_DEBUG }
);

export const publishImportedArticle = serverReadRequestId(_publishImportedArticle);

/**
 * Detects the source of content without full processing
 * Useful for showing auto-detected source before user confirms
 *
 * Used by: ImportModal component (for source dropdown default)
 * Calls: detectSource
 */
const _detectImportSource = withLogging(
    async function detectImportSource(content: string): Promise<{
        source: ImportSource;
        error: ErrorResponse | null;
    }> {
        try {
            const source = detectSource(content);
            return { source, error: null };
        } catch (error) {
            return {
                source: 'other',
                error: handleError(error, 'detectImportSource', { contentLength: content.length })
            };
        }
    },
    'detectImportSource',
    { enabled: FILE_DEBUG }
);

export const detectImportSource = serverReadRequestId(_detectImportSource);
