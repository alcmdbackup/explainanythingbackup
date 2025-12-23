/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { logger, getRequiredEnvVar } from '@/lib/server_utilities';
import OpenAI from 'openai';
import { Pinecone, RecordValues } from '@pinecone-database/pinecone';
import { createLLMSpan, createVectorSpan } from '../../../instrumentation';
import { AnchorSet, VectorSearchResult } from '@/lib/schemas/schemas';

const FILE_DEBUG = true
const maxNumberAnchors = 1

const openai = new OpenAI({
  apiKey: getRequiredEnvVar('OPENAI_API_KEY'),
});

const pc = new Pinecone({ 
  apiKey: getRequiredEnvVar('PINECONE_API_KEY') 
});

// Add interfaces at the top of the file
interface TextChunk {
  text: string;
  startIdx: number;
  length: number;
}

interface EmbeddedChunk extends TextChunk {
  embedding: number[];
}

/**
 * Splits text into chunks and tracks their positions in the original document
 * @param {string} document - The text to split
 * @param {number} chunkSize - Maximum size of each chunk (default: 1000)
 * @param {number} chunkOverlap - Number of characters to overlap (default: 200)
 * @returns {Promise<Array<{text: string, startIdx: number, length: number}>>}
 */
async function splitTextWithMetadata(document: string, chunkSize: number = 9999999999, chunkOverlap: number = 200): Promise<TextChunk[]> {
    // Initialize the text splitter with extremely large chunk size to create single chunk
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap,
        // Default separators that try to keep semantic meaning
        separators: ["\n\n", "\n", " ", ""]
    });

    // Get the chunks using splitText instead of createDocuments
    const chunks = await splitter.splitText(document);
    
    // Initialize result array and position tracker
    const result = [];
    let currentPosition = 0;
    
    for (const chunk of chunks) {
        // Find the start position of this chunk in the original document
        // We need to search from the current position to handle overlapping chunks
        const startIdx = document.indexOf(chunk, currentPosition);
        
        result.push({
            text: chunk,
            startIdx,
            length: chunk.length
        });
        
        // Update the current position to handle overlapping chunks
        // Move to the end of the non-overlapping portion
        currentPosition = startIdx + (chunk.length - chunkOverlap);
    }
    
    logger.debug('Result type:', { 
        type: typeof result
    }, FILE_DEBUG);
    
    logger.debug('Result is array:', { 
        isArray: Array.isArray(result)
    }, FILE_DEBUG);
    
    logger.debug('First two chunks:', { 
        chunks: result.slice(0, 2)
    }, FILE_DEBUG);
    
    return result;
}

/**
 * Creates embeddings for an array of text chunks using OpenAI's API
 * @param {Array<{text: string, startIdx: number, length: number}>} chunks - Array of text chunks with metadata
 * @returns {Promise<Array<{text: string, startIdx: number, length: number, embedding: number[]}>>}
 */
async function createEmbeddings(chunks: TextChunk[]): Promise<EmbeddedChunk[]> {
  // Add validation and debugging
  if (!chunks) {
    throw new Error('chunks parameter is required');
  }
  if (!Array.isArray(chunks)) {
    throw new Error(`chunks must be an array, received ${typeof chunks}`);
  }
  
  logger.debug('Creating embeddings for chunks:', {
    chunkCount: chunks.length,
    firstChunkPreview: chunks[0]?.text.slice(0, 100)
  }, FILE_DEBUG);

  const embeddingRequests = chunks.map(async chunk => {
    logger.debug('Processing chunk:', {
      chunkLength: chunk.text.length,
      startIdx: chunk.startIdx
    }, FILE_DEBUG);


    const span = createLLMSpan('openai.embeddings.create', {
      'llm.model': 'text-embedding-3-large',
      'llm.input.length': chunk.text.length,
      'llm.operation': 'embeddings'
    });
    
    let response;
    try {
      response = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: chunk.text,
      });
      
      span.setAttributes({
        'llm.response.tokens.prompt': response.usage?.prompt_tokens || 0,
        'llm.response.tokens.total': response.usage?.total_tokens || 0,
        'llm.response.embedding.dimensions': response.data[0]?.embedding.length || 0
      });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
    
    logger.debug('Embedding created:', {
      embeddingLength: response.data[0].embedding.length,
      embeddingPreview: response.data[0].embedding.slice(0, 3)
    }, FILE_DEBUG);

    return {
      ...chunk,
      embedding: response.data[0].embedding,
    };
  });

  const results = await Promise.all(embeddingRequests);
  logger.debug('All embeddings created:', {
    totalEmbeddings: results.length,
    averageEmbeddingLength: results.reduce((acc, r) => acc + r.embedding.length, 0) / results.length
  }, FILE_DEBUG);

  return results;
}

/**
 * Upserts embeddings into Pinecone index
 * @param {Array<{text: string, startIdx: number, length: number, embedding: number[]}>} embeddedChunks 
 * @param {string} namespace Optional namespace for multitenancy
 * @param {string} pineconeIndexEnvVar The environment variable for the Pinecone index
 * @param {object} metadata Metadata object containing explanation_id, topic_id, isAnchor (boolean), and anchorSet (AnchorSet | null)
 */
async function upsertEmbeddings(
  embeddedChunks: EmbeddedChunk[],
  namespace: string = '',
  pineconeIndexEnvVar: string,
  metadata: { explanation_id: number; topic_id: number; isAnchor: boolean; anchorSet: AnchorSet | null }
): Promise<void> {
  // Validate that anchorSet is not null when isAnchor is true
  if (metadata.isAnchor && metadata.anchorSet === null) {
    throw new Error('anchorSet cannot be null when isAnchor is true');
  }

  const index = pc.index(getRequiredEnvVar(pineconeIndexEnvVar));

  logger.debug('Creating vectors for upsert:', {
    chunkCount: embeddedChunks.length,
    namespace,
    ...metadata
  }, FILE_DEBUG);

  const vectors = embeddedChunks.map((chunk, i) => {
    // Generate a unique id by joining all metadata values and the chunk index
    const metaValues = Object.values(metadata).join('_');
    
    // Build metadata with non-null values for Pinecone compatibility
    const pineconeMetadata: Record<string, string | number | boolean> = {
      text: chunk.text,
      startIdx: chunk.startIdx,
      length: chunk.length,
      explanation_id: metadata.explanation_id,
      topic_id: metadata.topic_id,
      isAnchor: metadata.isAnchor
    };
    
    // Only add anchorSet if it's not null
    if (metadata.anchorSet !== null) {
      pineconeMetadata.anchorSet = metadata.anchorSet;
    }
    
    return {
      id: `chunk_${metaValues}_${i}`,
      values: chunk.embedding,
      metadata: pineconeMetadata
    };
  });

  // Modify the batching logic to process multiple batches concurrently
  const batchSize = 100;
  const maxConcurrentBatches = 3; // Adjust based on Pinecone's rate limits
  
  for (let i = 0; i < vectors.length; i += (batchSize * maxConcurrentBatches)) {
    const batchPromises = [];
    
    // Create concurrent batch promises
    for (let j = 0; j < maxConcurrentBatches; j++) {
      const startIdx = i + (j * batchSize);
      const batch = vectors.slice(startIdx, startIdx + batchSize);
      
      if (batch.length > 0) {
        logger.debug('Preparing batch:', {
          batchNumber: Math.floor(startIdx / batchSize) + 1,
          batchSize: batch.length,
          totalBatches: Math.ceil(vectors.length / batchSize)
        }, FILE_DEBUG);

        batchPromises.push(
          (async () => {

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
          })()
        );
      }
    }

    // Process batches concurrently
    await Promise.all(batchPromises);
  }

  logger.debug('Upsert complete:', {
    totalVectors: vectors.length,
    namespace
  }, FILE_DEBUG);
}

/**
 * Searches for similar vectors in Pinecone
 * @param {number[]} queryEmbedding The query embedding vector
 * @param {number} topK Number of results to return
 * @param {string} namespace Optional namespace to search in
 * @param {boolean} isAnchor Whether to filter for anchor vectors only
 * @param {AnchorSet | null} anchorSet The anchor set to filter by when isAnchor is true
 */
async function searchForSimilarVectors(queryEmbedding: number[], isAnchor: boolean = false, anchorSet: AnchorSet | null = null, topK: number = 5, namespace: string = 'default'): Promise<VectorSearchResult[]> {
    // Validate that anchorSet is not null when isAnchor is true
    if (isAnchor && anchorSet === null) {
        throw new Error('anchorSet cannot be null when isAnchor is true');
    }

    // Validate that queryEmbedding is an array of numbers
    if (!Array.isArray(queryEmbedding)) {
        throw new Error(`queryEmbedding must be an array, received ${typeof queryEmbedding}`);
    }
    
    if (!queryEmbedding.every(val => typeof val === 'number')) {
        throw new Error('queryEmbedding must contain only numbers');
    }

    logger.debug('Search parameters:', {
        embeddingPreview: queryEmbedding.slice(0, 2),
        embeddingLength: queryEmbedding.length,
        topK,
        namespace,
        isAnchor,
        anchorSet,
        embeddingSample: queryEmbedding.slice(0, 5), // Show first 5 values
        embeddingHasNaN: queryEmbedding.some(val => isNaN(val)),
        embeddingHasInfinity: queryEmbedding.some(val => !isFinite(val))
    }, FILE_DEBUG);

    const index = pc.Index(getRequiredEnvVar('PINECONE_INDEX_NAME_ALL'));


    const span = createVectorSpan('pinecone.query', {
        'pinecone.operation': 'query',
        'pinecone.topK': topK,
        'pinecone.namespace': namespace,
        'pinecone.index': getRequiredEnvVar('PINECONE_INDEX_NAME_ALL'),
        'pinecone.embedding.dimensions': queryEmbedding.length
    });

    let queryResponse;
    try {
        // Build query object with optional metadata filter
        const queryParams: any = {
            vector: queryEmbedding as RecordValues,
            topK,
            includeMetadata: true,
            includeValues: true // Ensure vector values are returned
        };

        // Add metadata filter when searching for anchor vectors
        if (isAnchor) {
            queryParams.filter = {
                isAnchor: { "$eq": true },
                anchorSet: { "$eq": anchorSet }
            };
        }

        queryResponse = await index.namespace(namespace).query(queryParams);
        
        span.setAttributes({
            'pinecone.query.matches': queryResponse.matches?.length || 0,
            'pinecone.query.success': 'true'
        });
    } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
    } finally {
        span.end();
    }

    logger.debug('Pinecone query response:', {
        matches_count: queryResponse.matches?.length || 0,
        matches_sample: queryResponse.matches?.slice(0, 2) || [],
        isAnchor,
        anchorSet,
        queryParams: {
            topK,
            includeMetadata: true,
            includeValues: true,
            hasFilter: isAnchor
        }
    }, FILE_DEBUG);

    // Cast to VectorSearchResult[] - metadata is always present when includeMetadata: true
    return queryResponse.matches as unknown as VectorSearchResult[];
}

/**
 * Creates an embedding for a single query string
 * @param {string} query - The text to create an embedding for
 * @returns {Promise<number[]>} The embedding vector
 */
async function createQueryEmbedding(query: string): Promise<number[]> {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  // Format query to match the expected input structure of createEmbeddings
  const formattedChunk = [{
    text: query,
    startIdx: 0,
    length: query.length
  }];

  const result = await createEmbeddings(formattedChunk);
  return result[0].embedding;
}

/**
 * Performs a complete query operation by creating an embedding and searching for matches
 * @param {string} query The search query text
 * @param {number} topK Number of results to return (default: 5)
 * @param {string} namespace Optional namespace to search in (default: '')
 * @param {boolean} isAnchor Whether to filter for anchor vectors only (default: false)
 * @param {AnchorSet | null} anchorSet The anchor set to filter by when isAnchor is true (default: null)
 * @returns {Promise<Array>} Array of matching results with their metadata
 */
async function findMatchesInVectorDb(query: string, isAnchor: boolean, anchorSet: AnchorSet | null, topK: number = 5, namespace: string = 'default'): Promise<VectorSearchResult[]> {
  const embedding = await createQueryEmbedding(query);
  
  logger.debug('Query details:', {
    query,
    embeddingPreview: embedding.slice(0, 5),
    embeddingLength: embedding.length,
    isAnchor,
    anchorSet
  }, FILE_DEBUG);
  
  return searchForSimilarVectors(embedding, isAnchor, anchorSet, topK, namespace);
}

/**
 * Calculates allowed scores based on anchor and explanation matches
 * @param {VectorSearchResult[]} anchorMatches - Results from anchor comparison search
 * @param {VectorSearchResult[]} explanationMatches - Results from explanation similarity search
 * @returns {Object} JSON object with anchorScore, explanationScore, and allowedTitle
 * • anchorScore: sum of all anchor similarities divided by maxNumberAnchors
 * • explanationScore: average score of top 3 explanation matches (padding with 0 if <3)
 * • allowedTitle: true if average of anchorScore + explanationScore > 0.15
 * • Used by returnExplanationLogic to evaluate content relevance
 * • Calls no other functions
 */
async function calculateAllowedScores(anchorMatches: VectorSearchResult[], explanationMatches: VectorSearchResult[]): Promise<{
  anchorScore: number;
  explanationScore: number;
  allowedTitle: boolean;
}> {
  // Calculate anchor score: sum of all similarities / maxNumberAnchors
  const anchorSimilaritySum = anchorMatches.reduce((sum, match) => sum + (match.score || 0), 0);
  const anchorScore = anchorSimilaritySum / maxNumberAnchors;
  
  // Calculate explanation score: average of top 3 matches, padding with 0 if needed
  const top3Matches = explanationMatches.slice(0, 3);
  const scores = [];
  
  // Get scores from top 3 matches
  for (let i = 0; i < 3; i++) {
    if (i < top3Matches.length) {
      scores.push(top3Matches[i].score || 0);
    } else {
      scores.push(0); // Pad with 0 if less than 3 matches
    }
  }
  
  const explanationScore = scores.reduce((sum, score) => sum + score, 0) / 3;
  
  // Calculate allowedTitle: true if average of both scores > 0.15
  const averageScore = (anchorScore + explanationScore) / 2;
  const allowedTitle = anchorScore >= 0; // Temporarily set to >= 0 to allow first anchor
  
  logger.debug('Allowed scores calculated:', {
    anchorMatchesCount: anchorMatches.length,
    explanationMatchesCount: explanationMatches.length,
    anchorSimilaritySum,
    anchorScore,
    top3Scores: scores,
    explanationScore,
    averageScore,
    allowedTitle
  }, FILE_DEBUG);
  
  return {
    anchorScore,
    explanationScore,
    allowedTitle
  };
}

/**
 * Processes text into embeddings and stores them in Pinecone
 * @param {string} markdown - The markdown text to process
 * @param {number} explanation_id - The ID of the explanation these embeddings belong to
 * @param {number} topic_id - The ID of the topic these embeddings belong to
 * @param {boolean} debug - Whether to enable debug logging
 * @param {string} namespace - The namespace to store embeddings in (default: 'default')
 * @returns {Promise<Object>} Result object with embedding statistics
 * @example
 * // Returns:
 * {
 *   success: true,
 *   chunkCount: 42,
 *   namespace: 'default'
 * }
 * @throws {Error} If embedding creation or storage fails
 */
async function processContentToStoreEmbedding(
  markdown: string,
  explanation_id: number,
  topic_id: number,
  _debug: boolean = false,
  namespace: string = 'default'
): Promise<{
  success: boolean;
  chunkCount: number;
  namespace: string;
}> {
    if (!markdown) {
        throw new Error('Markdown text is required');
    }
    if (typeof explanation_id !== 'number') {
        throw new Error('explanation_id must be a number');
    }
    if (typeof topic_id !== 'number') {
        throw new Error('topic_id must be a number');
    }

    // Split text into chunks with metadata
    const textChunks = await splitTextWithMetadata(markdown);
    logger.debug('Text chunks created', { 
        count: textChunks.length
    }, FILE_DEBUG);

    // Create embeddings for all chunks
    const embeddedChunks = await createEmbeddings(textChunks);
    logger.debug('Embeddings generated', { 
        count: embeddedChunks.length
    }, FILE_DEBUG);

    // Store in Pinecone
    await upsertEmbeddings(
      embeddedChunks,
      namespace,
      'PINECONE_INDEX_NAME_ALL',
      { explanation_id, topic_id, isAnchor: true, anchorSet: AnchorSet.Main }
    );

    return {
        success: true,
        chunkCount: embeddedChunks.length,
        namespace
    };
}

/**
 * Loads a single vector from Pinecone based on explanation_id metadata filter
 * @param {number} explanationId - The explanation ID to search for in metadata
 * @param {string} namespace - Optional namespace to search in (default: 'default')
 * @returns {Promise<any>} Single vector with metadata, embedding values, and vector data, or null if not found
 * • Queries Pinecone using metadata filter for specific explanation_id
 * • Returns the first vector chunk associated with the explanation with full vector values
 * • Used by results page to load explanation vector for comparison and analysis
 * • Calls no other functions
 */
async function loadFromPineconeUsingExplanationId(explanationId: number, namespace: string = 'default'): Promise<any | null> {
    if (typeof explanationId !== 'number') {
        throw new Error('explanationId must be a number');
    }

    logger.debug('Loading vectors from Pinecone for explanation:', {
        explanationId,
        namespace
    }, FILE_DEBUG);

    const indexName = getRequiredEnvVar('PINECONE_INDEX_NAME_ALL');
    logger.debug('Using Pinecone index:', { 
        indexName,
        hasApiKey: !!getRequiredEnvVar('PINECONE_API_KEY'),
        namespace 
    }, FILE_DEBUG);
    
    const index = pc.Index(indexName);

    const span = createVectorSpan('pinecone.query', {
        'pinecone.operation': 'query',
        'pinecone.namespace': namespace || 'default',
        'pinecone.index': getRequiredEnvVar('PINECONE_INDEX_NAME_ALL'),
        'pinecone.filter.explanation_id': explanationId
    });

    let queryResponse;
    // Create a dummy vector of the correct dimension for the query
    // We'll use a zero vector since we're only filtering by metadata
    const dummyVector = new Array(3072).fill(0); // text-embedding-3-large dimension

    const queryParams: any = {
        vector: dummyVector as RecordValues,
        topK: 1, // Only get the first vector chunk for the explanation
        includeMetadata: true,
        includeValues: true, // Ensure vector values are returned
        filter: {
            explanation_id: { "$eq": explanationId }
        }
    };

    try {
        queryResponse = await index.namespace(namespace).query(queryParams);
        
        span.setAttributes({
            'pinecone.query.matches': queryResponse.matches?.length || 0,
            'pinecone.query.success': 'true',
            'pinecone.query.found': queryResponse.matches && queryResponse.matches.length > 0 ? 'true' : 'false'
        });
    } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
    } finally {
        span.end();
    }

    logger.debug('Pinecone query response for explanation:', {
        explanationId,
        matchesCount: queryResponse.matches?.length || 0,
        found: queryResponse.matches && queryResponse.matches.length > 0,
        responseKeys: queryResponse ? Object.keys(queryResponse) : []
    }, FILE_DEBUG);

    // Return the first match or null if no matches found
    const result = queryResponse.matches && queryResponse.matches.length > 0 ? queryResponse.matches[0] : null;
    
    if (!result) {
        logger.debug('No vector found in Pinecone for explanation:', {
            explanationId,
            namespace,
            queryParams: {
                topK: queryParams.topK,
                includeMetadata: queryParams.includeMetadata,
                filter: queryParams.filter
            }
        }, FILE_DEBUG);
    } else {
        // Ensure the result has the expected structure with 'values' property
        // Pinecone might return vectors with different property names
        if (!result.values && (result as any).vector) {
            result.values = (result as any).vector;
        }
        
        logger.debug('Vector found in Pinecone for explanation:', {
            explanationId,
            namespace,
            resultKeys: Object.keys(result),
            hasValues: 'values' in result,
            valuesType: typeof result.values,
            isArray: Array.isArray(result.values),
            valuesLength: result.values?.length || 0,
            valuesPreview: result.values ? result.values.slice(0, 5) : null, // Preview of first 5 values
            hasId: 'id' in result,
            hasScore: 'score' in result,
            hasMetadata: 'metadata' in result,
            hasVector: 'vector' in (result as any),
            vectorType: typeof (result as any).vector,
            vectorLength: (result as any).vector?.length || 0
        }, FILE_DEBUG);
    }
    
    return result;
}

export { 
  findMatchesInVectorDb,
  processContentToStoreEmbedding,
  maxNumberAnchors,
  calculateAllowedScores,
  loadFromPineconeUsingExplanationId,
  searchForSimilarVectors
};