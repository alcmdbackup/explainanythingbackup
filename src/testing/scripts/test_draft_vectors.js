const { Pinecone } = require('@pinecone-database/pinecone');

// Initialize Pinecone client
const pc = new Pinecone({
    apiKey: 'pcsk_35T52g_JM5tokjv7gckNzannWm2DCXEsyQTezqKyLcoG9LoEucSu5t1C4LmCpvgQmwCBRe'
});

async function testDraftVectorSearch() {
    try {
        console.log('Testing draft article vectors in Pinecone...');

        const index = pc.Index('explainanythingdevlarge');

        // Create a dummy vector for the query (we only care about metadata filtering)
        const dummyVector = new Array(3072).fill(0); // text-embedding-3-large dimension

        // Test searching for Mike Alstott draft article (ID: 521)
        console.log('Searching for Mike Alstott draft article (ID: 521)...');

        const queryResponse = await index.namespace('default').query({
            vector: dummyVector,
            topK: 5,
            includeMetadata: true,
            includeValues: false, // Don't need the full vectors for this test
            filter: {
                explanation_id: { "$eq": 521 }
            }
        });

        console.log('Query response for explanation ID 521:');
        console.log('- Matches found:', queryResponse.matches?.length || 0);

        if (queryResponse.matches && queryResponse.matches.length > 0) {
            console.log('✅ FOUND! Draft article 521 (Mike Alstott) is indexed in Pinecone');
            console.log('First match metadata:', queryResponse.matches[0].metadata);
        } else {
            console.log('❌ NOT FOUND: Draft article 521 (Mike Alstott) is not in Pinecone');
        }

        // Test searching for Rashard Mendenhall draft article (ID: 520)
        console.log('\nSearching for Rashard Mendenhall draft article (ID: 520)...');

        const queryResponse2 = await index.namespace('default').query({
            vector: dummyVector,
            topK: 5,
            includeMetadata: true,
            includeValues: false,
            filter: {
                explanation_id: { "$eq": 520 }
            }
        });

        console.log('Query response for explanation ID 520:');
        console.log('- Matches found:', queryResponse2.matches?.length || 0);

        if (queryResponse2.matches && queryResponse2.matches.length > 0) {
            console.log('✅ FOUND! Draft article 520 (Rashard Mendenhall) is indexed in Pinecone');
            console.log('First match metadata:', queryResponse2.matches[0].metadata);
        } else {
            console.log('❌ NOT FOUND: Draft article 520 (Rashard Mendenhall) is not in Pinecone');
        }

        // Test a broader search to see any recent vectors
        console.log('\nSearching for any recent vectors (top 10)...');

        const recentQuery = await index.namespace('default').query({
            vector: dummyVector,
            topK: 10,
            includeMetadata: true,
            includeValues: false
        });

        console.log('Recent vectors found:', recentQuery.matches?.length || 0);
        if (recentQuery.matches && recentQuery.matches.length > 0) {
            console.log('Sample explanation IDs found:');
            recentQuery.matches.forEach((match, i) => {
                console.log(`  ${i + 1}. Explanation ID: ${match.metadata?.explanation_id}, Score: ${match.score}`);
            });
        }

    } catch (error) {
        console.error('Error testing draft vectors:', error);
    }
}

testDraftVectorSearch();