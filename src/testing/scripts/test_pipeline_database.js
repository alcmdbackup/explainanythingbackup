#!/usr/bin/env node

/**
 * Isolated Test Script for Pipeline Database Saving
 *
 * This script tests the database saving functions independently
 * to identify why pipeline stages aren't being saved to Supabase.
 */

const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL');
    process.exit(1);
}

// Try service key first, fallback to anon key
const supabaseKey = supabaseServiceKey || supabaseAnonKey;
if (!supabaseKey) {
    console.error('❌ Missing both SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(1);
}

console.log('🔑 Using Supabase key type:', supabaseServiceKey ? 'SERVICE_ROLE' : 'ANON');
const supabase = createClient(supabaseUrl, supabaseKey);

// Test data
const testSessionData = {
    session_id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    }),
    explanation_id: 999,
    explanation_title: 'Test Pipeline Session',
    user_prompt: 'Test prompt for debugging pipeline saves',
    source_content: 'Original test content for pipeline debugging',
    session_metadata: {
        step: 'test_step',
        processing_time: Date.now(),
        test_run: true
    }
};

const testContent = JSON.stringify({
    test: true,
    content: 'Sample pipeline stage content',
    timestamp: new Date().toISOString()
});

/**
 * Test the basic table structure and connection
 */
async function testTableConnection() {
    console.log('\n🔍 Testing table connection and structure...');

    try {
        // Check if table exists and get structure
        const { data, error } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .limit(1);

        if (error) {
            console.error('❌ Table connection error:', error);
            return false;
        }

        console.log('✅ Table connection successful');
        console.log('📋 Sample data structure:', data);
        return true;
    } catch (err) {
        console.error('❌ Connection test failed:', err);
        return false;
    }
}

/**
 * Test the table schema
 */
async function testTableSchema() {
    console.log('\n📊 Testing table schema...');

    try {
        // Get table information from information_schema
        const { data, error } = await supabase
            .rpc('get_table_schema', { table_name: 'testing_edits_pipeline' })
            .single();

        if (error) {
            console.log('⚠️ RPC not available, using direct query...');

            // Alternative: direct query to check columns
            const { error: tableError } = await supabase
                .from('testing_edits_pipeline')
                .select('*')
                .limit(0); // Get structure without data

            if (tableError) {
                console.error('❌ Schema check failed:', tableError);
                return false;
            }

            console.log('✅ Table exists and is accessible');
        } else {
            console.log('✅ Table schema:', data);
        }

        return true;
    } catch (err) {
        console.error('❌ Schema test failed:', err);
        return false;
    }
}

/**
 * Test checkAndSaveTestingPipelineRecord equivalent
 */
async function testDirectSave() {
    console.log('\n💾 Testing direct database save...');

    try {
        const recordData = {
            set_name: 'test-pipeline-debug',
            step: 'test_direct_save',
            content: testContent,
            session_id: testSessionData.session_id,
            explanation_id: testSessionData.explanation_id,
            explanation_title: testSessionData.explanation_title,
            user_prompt: testSessionData.user_prompt,
            source_content: testSessionData.source_content,
            session_metadata: testSessionData.session_metadata,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        console.log('📝 Attempting to insert record:', {
            set_name: recordData.set_name,
            step: recordData.step,
            session_id: recordData.session_id,
            explanation_id: recordData.explanation_id,
            content_length: recordData.content.length
        });

        const { data, error } = await supabase
            .from('testing_edits_pipeline')
            .insert([recordData])
            .select();

        if (error) {
            console.error('❌ Direct save failed:', error);
            console.error('Error details:', {
                message: error.message,
                details: error.details,
                hint: error.hint,
                code: error.code
            });
            return false;
        }

        console.log('✅ Direct save successful!');
        console.log('📋 Inserted record:', data);
        return data[0];
    } catch (err) {
        console.error('❌ Direct save exception:', err);
        return false;
    }
}

/**
 * Test upsert functionality (update existing or create new)
 */
async function testUpsertSave() {
    console.log('\n🔄 Testing upsert save...');

    try {
        const recordData = {
            set_name: 'test-pipeline-debug',
            step: 'test_upsert_save',
            content: testContent + '_updated',
            session_id: testSessionData.session_id,
            explanation_id: testSessionData.explanation_id,
            explanation_title: testSessionData.explanation_title,
            user_prompt: testSessionData.user_prompt,
            source_content: testSessionData.source_content,
            session_metadata: { ...testSessionData.session_metadata, updated: true },
            updated_at: new Date().toISOString()
        };

        console.log('📝 Attempting upsert...');

        const { data, error } = await supabase
            .from('testing_edits_pipeline')
            .upsert([recordData], {
                onConflict: 'set_name,step',
                ignoreDuplicates: false
            })
            .select();

        if (error) {
            console.error('❌ Upsert failed:', error);
            return false;
        }

        console.log('✅ Upsert successful!');
        console.log('📋 Upserted record:', data);
        return data[0];
    } catch (err) {
        console.error('❌ Upsert exception:', err);
        return false;
    }
}

/**
 * Test with session data (simulating the real pipeline)
 */
async function testSessionSave() {
    console.log('\n🎯 Testing session-based save (simulating real pipeline)...');

    const steps = [
        'step1_ai_suggestions',
        'step2_applied_edits',
        'step3_critic_markup',
        'step4_preprocessed'
    ];

    const results = [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepContent = JSON.stringify({
            step: step,
            content: `Sample content for ${step}`,
            timestamp: new Date().toISOString(),
            step_number: i + 1
        });

        try {
            console.log(`📝 Saving step ${i + 1}: ${step}...`);

            const recordData = {
                set_name: 'ai-suggestion-session',
                step: step,
                content: stepContent,
                session_id: testSessionData.session_id,
                explanation_id: testSessionData.explanation_id,
                explanation_title: testSessionData.explanation_title,
                user_prompt: testSessionData.user_prompt,
                source_content: testSessionData.source_content,
                session_metadata: {
                    ...testSessionData.session_metadata,
                    step: step,
                    step_number: i + 1
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('testing_edits_pipeline')
                .upsert([recordData], {
                    onConflict: 'set_name,step',
                    ignoreDuplicates: false
                })
                .select();

            if (error) {
                console.error(`❌ Step ${step} save failed:`, error);
                results.push({ step, success: false, error });
            } else {
                console.log(`✅ Step ${step} saved successfully`);
                results.push({ step, success: true, data: data[0] });
            }

        } catch (err) {
            console.error(`❌ Step ${step} exception:`, err);
            results.push({ step, success: false, error: err });
        }
    }

    return results;
}

/**
 * Test querying saved records
 */
async function testQueryRecords() {
    console.log('\n🔍 Testing record queries...');

    try {
        // Query by session_id
        console.log('📋 Querying records by session_id...');
        const { data: sessionRecords, error: sessionError } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .eq('session_id', testSessionData.session_id)
            .order('created_at', { ascending: true });

        if (sessionError) {
            console.error('❌ Session query failed:', sessionError);
        } else {
            console.log(`✅ Found ${sessionRecords.length} session records:`);
            sessionRecords.forEach(record => {
                console.log(`  - ${record.step}: ${record.content.substring(0, 50)}...`);
            });
        }

        // Query by set_name
        console.log('\n📋 Querying records by set_name...');
        const { data: setRecords, error: setError } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .eq('set_name', 'ai-suggestion-session')
            .order('created_at', { ascending: false })
            .limit(10);

        if (setError) {
            console.error('❌ Set query failed:', setError);
        } else {
            console.log(`✅ Found ${setRecords.length} ai-suggestion-session records`);
        }

        return { sessionRecords, setRecords };
    } catch (err) {
        console.error('❌ Query test failed:', err);
        return null;
    }
}

/**
 * Clean up test records
 */
async function cleanupTestRecords() {
    console.log('\n🧹 Cleaning up test records...');

    try {
        const { error } = await supabase
            .from('testing_edits_pipeline')
            .delete()
            .eq('session_id', testSessionData.session_id);

        if (error) {
            console.error('❌ Cleanup failed:', error);
        } else {
            console.log('✅ Test records cleaned up');
        }
    } catch (err) {
        console.error('❌ Cleanup exception:', err);
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🧪 Starting Pipeline Database Tests');
    console.log('=' * 50);

    console.log('📊 Test Configuration:');
    console.log('  Session ID:', testSessionData.session_id);
    console.log('  Explanation ID:', testSessionData.explanation_id);
    console.log('  Supabase URL:', supabaseUrl);
    console.log('  Service Key Available:', !!supabaseServiceKey);

    const results = {
        tableConnection: false,
        tableSchema: false,
        directSave: false,
        upsertSave: false,
        sessionSave: false,
        queryRecords: false
    };

    // Test 1: Table Connection
    results.tableConnection = await testTableConnection();
    if (!results.tableConnection) {
        console.log('\n❌ Stopping tests - table connection failed');
        return results;
    }

    // Test 2: Table Schema
    results.tableSchema = await testTableSchema();

    // Test 3: Direct Save
    results.directSave = await testDirectSave();

    // Test 4: Upsert Save
    results.upsertSave = await testUpsertSave();

    // Test 5: Session Save (multiple steps)
    const sessionResults = await testSessionSave();
    results.sessionSave = sessionResults.every(r => r.success);

    // Test 6: Query Records
    const queryResults = await testQueryRecords();
    results.queryRecords = !!queryResults;

    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('=' * 30);
    console.log('Table Connection:', results.tableConnection ? '✅' : '❌');
    console.log('Table Schema:', results.tableSchema ? '✅' : '❌');
    console.log('Direct Save:', results.directSave ? '✅' : '❌');
    console.log('Upsert Save:', results.upsertSave ? '✅' : '❌');
    console.log('Session Save:', results.sessionSave ? '✅' : '❌');
    console.log('Query Records:', results.queryRecords ? '✅' : '❌');

    const allPassed = Object.values(results).every(r => r);
    console.log('\n🎯 OVERALL RESULT:', allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');

    if (allPassed) {
        console.log('\n💡 Database saving should work correctly!');
        console.log('   The issue might be in how the functions are being called.');
    } else {
        console.log('\n🔧 Database saving has issues that need to be resolved.');
    }

    // Ask if we should cleanup
    const shouldCleanup = process.argv.includes('--cleanup');
    if (shouldCleanup) {
        await cleanupTestRecords();
    } else {
        console.log('\n💡 Run with --cleanup flag to remove test records');
        console.log('   Test records left in database for inspection:');
        console.log('   Session ID:', testSessionData.session_id);
    }

    return results;
}

// Run the tests
if (require.main === module) {
    runTests()
        .then(results => {
            const exitCode = Object.values(results).every(r => r) ? 0 : 1;
            process.exit(exitCode);
        })
        .catch(err => {
            console.error('❌ Test runner failed:', err);
            process.exit(1);
        });
}

module.exports = {
    runTests,
    testTableConnection,
    testDirectSave,
    testSessionSave
};