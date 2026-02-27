/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Vector similarity service: embeds text via OpenAI, stores/queries vectors in Pinecone.
 */
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { logger, getRequiredEnvVar } from '@/lib/server_utilities';
import OpenAI from 'openai';
import { Pinecone, RecordValues } from '@pinecone-database/pinecone';
import { createLLMSpan, createVectorSpan } from '../../../instrumentation';
import { AnchorSet, VectorSearchResult } from '@/lib/schemas/schemas';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

const FILE_DEBUG = true;
const maxNumberAnchors = 1;

// Lazy-initialized clients — avoids crashing at import time when env vars are missing (e.g. in tests)
let _openai: OpenAI | null = null;
let _pc: Pinecone | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: getRequiredEnvVar('OPENAI_API_KEY') });
  }
  return _openai;
}

function getPineconeClient(): Pinecone {
  if (!_pc) {
    _pc = new Pinecone({ apiKey: getRequiredEnvVar('PINECONE_API_KEY') });
  }
  return _pc;
}

interface TextChunk {
  text: string;
  startIdx: number;
  length: number;
}

interface EmbeddedChunk extends TextChunk {
  embedding: number[];
}

/** Splits text into chunks and tracks their positions in the original document. */
async function splitTextWithMetadata(document: string, chunkSize: number = 9999999999, chunkOverlap: number = 200): Promise<TextChunk[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap,
        separators: ["\n\n", "\n", " ", ""]
    });

    const chunks = await splitter.splitText(document);
    const result: TextChunk[] = [];
    let currentPosition = 0;

    for (const chunk of chunks) {
        // Search from currentPosition to handle overlapping chunks correctly
        const startIdx = document.indexOf(chunk, currentPosition);
        result.push({ text: chunk, startIdx, length: chunk.length });
        currentPosition = startIdx + (chunk.length - chunkOverlap);
    }

    logger.debug('Split text into chunks:', {
        chunkCount: result.length,
        firstTwoChunks: result.slice(0, 2)
    }, FILE_DEBUG);

    return result;
}

/** Creates embeddings for an array of text chunks using OpenAI's API. */
async function createEmbeddings(chunks: TextChunk[]): Promise<EmbeddedChunk[]> {
  if (!chunks || !Array.isArray(chunks)) {
    throw new Error(`chunks must be an array, received ${typeof chunks}`);
  }

  logger.debug('Creating embeddings for chunks:', {
    chunkCount: chunks.length,
    firstChunkPreview: chunks[0]?.text.slice(0, 100)
  }, FILE_DEBUG);

  const results = await Promise.all(chunks.map(async (chunk): Promise<EmbeddedChunk> => {
    const span = createLLMSpan('openai.embeddings.create', {
      'llm.model': 'text-embedding-3-large',
      'llm.input.length': chunk.text.length,
      'llm.operation': 'embeddings'
    });

    try {
      const response = await getOpenAIClient().embeddings.create({
        model: "text-embedding-3-large",
        input: chunk.text,
      });

      span.setAttributes({
        'llm.response.tokens.prompt': response.usage?.prompt_tokens || 0,
        'llm.response.tokens.total': response.usage?.total_tokens || 0,
        'llm.response.embedding.dimensions': response.data[0]?.embedding.length || 0
      });

      return { ...chunk, embedding: response.data[0].embedding };
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }));

  logger.debug('All embeddings created:', {
    totalEmbeddings: results.length,
    embeddingDimensions: results[0]?.embedding.length || 0
  }, FILE_DEBUG);

  return results;
}

/** Upserts embeddings into a Pinecone index with concurrent batching. */
async function upsertEmbeddings(
  embeddedChunks: EmbeddedChunk[],
  namespace: string = '',
  pineconeIndexEnvVar: string,
  metadata: { explanation_id: number; topic_id: number; isAnchor: boolean; anchorSet: AnchorSet | null }
): Promise<void> {
  if (metadata.isAnchor && metadata.anchorSet === null) {
    throw new Error('anchorSet cannot be null when isAnchor is true');
  }

  const index = getPineconeClient().index(getRequiredEnvVar(pineconeIndexEnvVar));
  const metaValues = Object.values(metadata).join('_');

  logger.debug('Creating vectors for upsert:', {
    chunkCount: embeddedChunks.length,
    namespace,
    ...metadata
  }, FILE_DEBUG);

  const vectors = embeddedChunks.map((chunk, i) => {
    const pineconeMetadata: Record<string, string | number | boolean> = {
      text: chunk.text,
      startIdx: chunk.startIdx,
      length: chunk.length,
      explanation_id: metadata.explanation_id,
      topic_id: metadata.topic_id,
      isAnchor: metadata.isAnchor
    };

    if (metadata.anchorSet !== null) {
      pineconeMetadata.anchorSet = metadata.anchorSet;
    }

    return {
      id: `chunk_${metaValues}_${i}`,
      values: chunk.embedding,
      metadata: pineconeMetadata
    };
  });

  const batchSize = 100;
  const maxConcurrentBatches = 3;

  for (let i = 0; i < vectors.length; i += batchSize * maxConcurrentBatches) {
    const batchPromises: Promise<void>[] = [];

    for (let j = 0; j < maxConcurrentBatches; j++) {
      const startIdx = i + j * batchSize;
      const batch = vectors.slice(startIdx, startIdx + batchSize);
      if (batch.length === 0) continue;

      batchPromises.push((async () => {
        const span = createVectorSpan('pinecone.upsert', {
          'pinecone.operation': 'upsert',
          'pinecone.batch.size': batch.length,
          'pinecone.namespace': namespace || 'default',
          'pinecone.index': getRequiredEnvVar(pineconeIndexEnvVar)
        });

        try {
          await index.namespace(namespace).upsert(batch);
          span.setAttributes({
            'pinecone.upsert.success': 'true',
            'pinecone.vectors.count': batch.length
          });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: 2, message: (error as Error).message });
          throw error;
        } finally {
          span.end();
        }
      })());
    }

    await Promise.all(batchPromises);
  }

  logger.debug('Upsert complete:', {
    totalVectors: vectors.length,
    namespace
  }, FILE_DEBUG);
}

/** Searches for similar vectors in Pinecone, optionally filtering by anchor set. */
async function searchForSimilarVectorsImpl(
  queryEmbedding: number[],
  isAnchor: boolean = false,
  anchorSet: AnchorSet | null = null,
  topK: number = 5,
  namespace: string = 'default'
): Promise<VectorSearchResult[]> {
    if (isAnchor && anchorSet === null) {
        throw new Error('anchorSet cannot be null when isAnchor is true');
    }
    if (!Array.isArray(queryEmbedding) || !queryEmbedding.every(val => typeof val === 'number')) {
        throw new Error(`queryEmbedding must be an array of numbers, received ${typeof queryEmbedding}`);
    }

    logger.debug('Search parameters:', {
        embeddingLength: queryEmbedding.length,
        embeddingSample: queryEmbedding.slice(0, 5),
        topK, namespace, isAnchor, anchorSet,
        hasNaN: queryEmbedding.some(val => isNaN(val)),
        hasInfinity: queryEmbedding.some(val => !isFinite(val))
    }, FILE_DEBUG);

    const index = getPineconeClient().Index(getRequiredEnvVar('PINECONE_INDEX_NAME_ALL'));
    const span = createVectorSpan('pinecone.query', {
        'pinecone.operation': 'query',
        'pinecone.topK': topK,
        'pinecone.namespace': namespace,
        'pinecone.index': getRequiredEnvVar('PINECONE_INDEX_NAME_ALL'),
        'pinecone.embedding.dimensions': queryEmbedding.length
    });

    try {
        const queryParams: any = {
            vector: queryEmbedding as RecordValues,
            topK,
            includeMetadata: true,
            includeValues: true
        };

        if (isAnchor) {
            queryParams.filter = {
                isAnchor: { "$eq": true },
                anchorSet: { "$eq": anchorSet }
            };
        }

        const queryResponse = await index.namespace(namespace).query(queryParams);

        span.setAttributes({
            'pinecone.query.matches': queryResponse.matches?.length || 0,
            'pinecone.query.success': 'true'
        });

        logger.debug('Pinecone query response:', {
            matchesCount: queryResponse.matches?.length || 0,
            matchesSample: queryResponse.matches?.slice(0, 2) || [],
            isAnchor, anchorSet
        }, FILE_DEBUG);

        return queryResponse.matches as unknown as VectorSearchResult[];
    } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
    } finally {
        span.end();
    }
}

/** Creates an embedding for a single query string. */
async function createQueryEmbedding(query: string): Promise<number[]> {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  const result = await createEmbeddings([{ text: query, startIdx: 0, length: query.length }]);
  return result[0].embedding;
}

/** Embeds a query string and searches for matching vectors in Pinecone. */
async function findMatchesInVectorDbImpl(
  query: string,
  isAnchor: boolean,
  anchorSet: AnchorSet | null,
  topK: number = 5,
  namespace: string = 'default'
): Promise<VectorSearchResult[]> {
  const embedding = await createQueryEmbedding(query);

  logger.debug('Query details:', {
    query, embeddingLength: embedding.length, isAnchor, anchorSet
  }, FILE_DEBUG);

  return searchForSimilarVectorsImpl(embedding, isAnchor, anchorSet, topK, namespace);
}

/**
 * Calculates allowed scores based on anchor and explanation matches.
 * anchorScore: sum of similarities / maxNumberAnchors
 * explanationScore: average of top 3 matches (padded with 0 if <3)
 * allowedTitle: currently always true (anchorScore >= 0) to allow first anchor
 */
async function calculateAllowedScoresImpl(
  anchorMatches: VectorSearchResult[],
  explanationMatches: VectorSearchResult[]
): Promise<{ anchorScore: number; explanationScore: number; allowedTitle: boolean }> {
  const anchorScore = anchorMatches.reduce((sum, m) => sum + (m.score || 0), 0) / maxNumberAnchors;

  // Average of top 3 explanation match scores, padding missing slots with 0
  const top3Scores = Array.from({ length: 3 }, (_, i) => explanationMatches[i]?.score || 0);
  const explanationScore = top3Scores.reduce((sum, s) => sum + s, 0) / 3;

  // Temporarily >= 0 to allow first anchor; will be changed to threshold-based check
  const allowedTitle = anchorScore >= 0;

  logger.debug('Allowed scores calculated:', {
    anchorMatchesCount: anchorMatches.length,
    explanationMatchesCount: explanationMatches.length,
    anchorScore, top3Scores, explanationScore, allowedTitle
  }, FILE_DEBUG);

  return { anchorScore, explanationScore, allowedTitle };
}

/** Processes markdown text into embeddings and stores them in Pinecone. */
async function processContentToStoreEmbeddingImpl(
  markdown: string,
  explanation_id: number,
  topic_id: number,
  _debug: boolean = false,
  namespace: string = 'default'
): Promise<{ success: boolean; chunkCount: number; namespace: string }> {
    if (!markdown) {
        throw new Error('Markdown text is required');
    }
    if (typeof explanation_id !== 'number') {
        throw new Error('explanation_id must be a number');
    }
    if (typeof topic_id !== 'number') {
        throw new Error('topic_id must be a number');
    }

    const textChunks = await splitTextWithMetadata(markdown);
    const embeddedChunks = await createEmbeddings(textChunks);

    logger.debug('Embedding pipeline complete', {
        textChunks: textChunks.length,
        embeddedChunks: embeddedChunks.length
    }, FILE_DEBUG);

    await upsertEmbeddings(
      embeddedChunks,
      namespace,
      'PINECONE_INDEX_NAME_ALL',
      { explanation_id, topic_id, isAnchor: true, anchorSet: AnchorSet.Main }
    );

    return { success: true, chunkCount: embeddedChunks.length, namespace };
}

/** Loads a single vector from Pinecone by explanation_id metadata filter. Returns null if not found. */
async function loadFromPineconeUsingExplanationIdImpl(explanationId: number, namespace: string = 'default'): Promise<any | null> {
    if (typeof explanationId !== 'number') {
        throw new Error('explanationId must be a number');
    }

    logger.debug('Loading vector from Pinecone:', { explanationId, namespace }, FILE_DEBUG);

    const indexName = getRequiredEnvVar('PINECONE_INDEX_NAME_ALL');
    const index = getPineconeClient().Index(indexName);

    // Zero vector for metadata-only query (text-embedding-3-large = 3072 dimensions)
    const dummyVector = new Array(3072).fill(0);

    const span = createVectorSpan('pinecone.query', {
        'pinecone.operation': 'query',
        'pinecone.namespace': namespace || 'default',
        'pinecone.index': indexName,
        'pinecone.filter.explanation_id': explanationId
    });

    try {
        const queryResponse = await index.namespace(namespace).query({
            vector: dummyVector as RecordValues,
            topK: 1,
            includeMetadata: true,
            includeValues: true,
            filter: { explanation_id: { "$eq": explanationId } }
        });

        const found = (queryResponse.matches?.length || 0) > 0;
        span.setAttributes({
            'pinecone.query.matches': queryResponse.matches?.length || 0,
            'pinecone.query.success': 'true',
            'pinecone.query.found': found ? 'true' : 'false'
        });

        const result = found ? queryResponse.matches![0] : null;

        if (result) {
            // Normalize: some Pinecone versions use 'vector' instead of 'values'
            if (!result.values && (result as any).vector) {
                result.values = (result as any).vector;
            }
            logger.debug('Vector found:', {
                explanationId, valuesLength: result.values?.length || 0
            }, FILE_DEBUG);
        } else {
            logger.debug('No vector found:', { explanationId, namespace }, FILE_DEBUG);
        }

        return result;
    } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
    } finally {
        span.end();
    }
}

// Wrap all async functions with automatic logging for entry/exit/timing
const findMatchesInVectorDb = withLogging(
  findMatchesInVectorDbImpl,
  'findMatchesInVectorDb',
  { logErrors: true }
);

const processContentToStoreEmbedding = withLogging(
  processContentToStoreEmbeddingImpl,
  'processContentToStoreEmbedding',
  { logErrors: true }
);

const calculateAllowedScores = withLogging(
  calculateAllowedScoresImpl,
  'calculateAllowedScores',
  { logErrors: true }
);

const loadFromPineconeUsingExplanationId = withLogging(
  loadFromPineconeUsingExplanationIdImpl,
  'loadFromPineconeUsingExplanationId',
  { logErrors: true }
);

const searchForSimilarVectors = withLogging(
  searchForSimilarVectorsImpl,
  'searchForSimilarVectors',
  { logErrors: true }
);

/** Deletes all vectors for an explanation from Pinecone (query by metadata, then delete by ID). */
async function deleteVectorsByExplanationIdImpl(
  explanationId: number,
  namespace: string = 'default'
): Promise<number> {
  if (typeof explanationId !== 'number') {
    throw new Error('explanationId must be a number');
  }

  const indexName = getRequiredEnvVar('PINECONE_INDEX_NAME_ALL');
  const index = getPineconeClient().Index(indexName);
  const dummyVector = new Array(3072).fill(0); // text-embedding-3-large dimensions

  logger.debug('Deleting vectors for explanation:', { explanationId, namespace }, FILE_DEBUG);

  const queryResponse = await index.namespace(namespace).query({
    vector: dummyVector as RecordValues,
    topK: 10000,
    includeMetadata: false,
    filter: { explanation_id: { "$eq": explanationId } }
  });

  const vectorIds = queryResponse.matches?.map(m => m.id) || [];
  if (vectorIds.length === 0) {
    logger.debug('No vectors found to delete:', { explanationId }, FILE_DEBUG);
    return 0;
  }

  // Delete in batches of 1000 (Pinecone limit)
  for (let i = 0; i < vectorIds.length; i += 1000) {
    const batch = vectorIds.slice(i, i + 1000);
    await index.namespace(namespace).deleteMany(batch);
  }

  logger.debug('Vector deletion complete:', { explanationId, totalDeleted: vectorIds.length }, FILE_DEBUG);
  return vectorIds.length;
}

const deleteVectorsByExplanationId = withLogging(
  deleteVectorsByExplanationIdImpl,
  'deleteVectorsByExplanationId',
  { logErrors: true }
);

export {
  findMatchesInVectorDb,
  processContentToStoreEmbedding,
  maxNumberAnchors,
  calculateAllowedScores,
  loadFromPineconeUsingExplanationId,
  searchForSimilarVectors,
  deleteVectorsByExplanationId
};