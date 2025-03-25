import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { logger, getRequiredEnvVar } from '@/lib/server_utilities';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

const FILE_DEBUG = true

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

interface Vector {
  id: string;
  values: number[];
  metadata: TextChunk;
}

/**
 * Splits text into chunks and tracks their positions in the original document
 * @param {string} document - The text to split
 * @param {number} chunkSize - Maximum size of each chunk (default: 1000)
 * @param {number} chunkOverlap - Number of characters to overlap (default: 200)
 * @returns {Promise<Array<{text: string, startIdx: number, length: number}>>}
 */
async function splitTextWithMetadata(document: string, chunkSize: number = 20000, chunkOverlap: number = 200): Promise<TextChunk[]> {
    // Initialize the text splitter
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

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunk.text,
    });
    
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
 * @param {number} explanation_id The ID of the explanation these embeddings belong to
 */
async function upsertEmbeddings(embeddedChunks: EmbeddedChunk[], namespace: string = '', explanation_id: number): Promise<void> {
  const index = pc.index(getRequiredEnvVar('PINECONE_INDEX_NAME'));

  logger.debug('Creating vectors for upsert:', {
    chunkCount: embeddedChunks.length,
    namespace,
    explanation_id
  }, FILE_DEBUG);

  const vectors = embeddedChunks.map((chunk, i) => ({
    id: `chunk_${i}`,
    values: chunk.embedding,
    metadata: {
      text: chunk.text,
      startIdx: chunk.startIdx,
      length: chunk.length,
      explanation_id
    }
  }));

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
            await index.namespace(namespace).upsert(batch);
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
 */
async function searchForSimilarVectors(queryEmbedding: number[], topK: number = 5, namespace: string = ''): Promise<any[]> {
    logger.debug('Search parameters:', {
        embeddingPreview: queryEmbedding.slice(0, 2),
        embeddingLength: queryEmbedding.length,
        topK,
        namespace
    }, FILE_DEBUG);

    const index = pc.Index(getRequiredEnvVar('PINECONE_INDEX_NAME'));

    const queryResponse = await index.namespace(namespace).query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true
    });

    logger.debug('Pinecone query response:', queryResponse, FILE_DEBUG);

    return queryResponse.matches;
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
 * @returns {Promise<Array>} Array of matching results with their metadata
 */
async function handleUserQuery(query: string, topK: number = 5, namespace: string = 'default'): Promise<any[]> {
  const embedding = await createQueryEmbedding(query);
  
  logger.debug('Query details:', {
    query,
    embeddingPreview: embedding.slice(0, 5),
    embeddingLength: embedding.length
  }, FILE_DEBUG);
  
  return searchForSimilarVectors(embedding, topK, namespace);
}

/**
 * Processes text into embeddings and stores them in Pinecone
 * @param {string} markdown - The markdown text to process
 * @param {number} explanation_id - The ID of the explanation these embeddings belong to
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
  debug: boolean = false,
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
    await upsertEmbeddings(embeddedChunks, namespace, explanation_id);

    return {
        success: true,
        chunkCount: embeddedChunks.length,
        namespace
    };
}

export { 
  handleUserQuery,
  processContentToStoreEmbedding
};