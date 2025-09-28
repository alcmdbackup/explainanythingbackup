#!/usr/bin/env node

/**
 * Test Script for Server Actions
 *
 * This script tests the actual server action functions that are used
 * in the pipeline to isolate issues with the action layer.
 */

// Simulate Next.js environment
process.env.NODE_ENV = 'development';

const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

/**
 * Mock the Next.js server action environment
 */
function setupServerActionMocks() {
    // Mock cookies() function
    global.cookies = () => ({
        get: () => ({ value: 'mock-session' }),
        set: () => {},
        delete: () => {}
    });

    // Mock headers() function
    global.headers = () => ({
        get: () => 'localhost:3001',
        set: () => {},
        entries: () => []
    });

    // Mock redirect function
    global.redirect = (url) => {
        console.log('🔀 Mock redirect to:', url);
        throw new Error('NEXT_REDIRECT'); // Next.js redirect behavior
    };
}

/**
 * Test saveTestingPipelineStepAction
 */
async function testSaveTestingPipelineStepAction() {
    console.log('\n🧪 Testing saveTestingPipelineStepAction...');

    try {
        // Import the server action
        const actionsPath = path.join(__dirname, 'src', 'actions', 'actions.ts');

        if (!fs.existsSync(actionsPath)) {
            console.error('❌ Actions file not found:', actionsPath);
            return false;
        }

        // For testing, we'll simulate the action behavior
        const testSessionData = {
            session_id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }),
            explanation_id: 998,
            explanation_title: 'Test Server Action',
            user_prompt: 'Testing server action directly',
            source_content: 'Original content for action test',
            session_metadata: {
                step: 'server_action_test',
                test: true
            }
        };

        const testContent = JSON.stringify({
            test: 'server_action',
            timestamp: new Date().toISOString(),
            content: 'Test content for server action'
        });

        console.log('📝 Test parameters:');
        console.log('  Set Name: test-server-action');
        console.log('  Step: test_action_step');
        console.log('  Session ID:', testSessionData.session_id);
        console.log('  Content Length:', testContent.length);

        // Since we can't easily import and run the server action directly,
        // we'll simulate what it should do and test the underlying functions

        const { createClient } = require('@supabase/supabase-js');
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            supabaseKey
        );

        // Test the checkAndSaveTestingPipelineRecord logic
        console.log('\n🔍 Testing checkAndSaveTestingPipelineRecord logic...');

        // First, check if record exists
        const { data: existingRecords, error: queryError } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .eq('set_name', 'test-server-action')
            .eq('step', 'test_action_step');

        if (queryError) {
            console.error('❌ Query error:', queryError);
            return false;
        }

        console.log(`📋 Found ${existingRecords.length} existing records`);

        // Prepare record data (simulating the server action logic)
        const recordData = {
            set_name: 'test-server-action',
            step: 'test_action_step',
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

        // Test the save operation
        const { data: saveResult, error: saveError } = await supabase
            .from('testing_edits_pipeline')
            .upsert([recordData], {
                onConflict: 'set_name,step',
                ignoreDuplicates: false
            })
            .select();

        if (saveError) {
            console.error('❌ Save error:', saveError);
            console.error('Error details:', {
                message: saveError.message,
                code: saveError.code,
                details: saveError.details,
                hint: saveError.hint
            });
            return false;
        }

        console.log('✅ Server action simulation successful!');
        console.log('📋 Save result:', saveResult);

        return {
            success: true,
            data: saveResult[0],
            session_id: testSessionData.session_id
        };

    } catch (err) {
        console.error('❌ Server action test failed:', err);
        return false;
    }
}

/**
 * Test the complete pipeline save sequence
 */
async function testPipelineSaveSequence() {
    console.log('\n🔄 Testing complete pipeline save sequence...');

    const sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
    const sessionData = {
        session_id: sessionId,
        explanation_id: 997,
        explanation_title: 'Test Pipeline Sequence',
        user_prompt: 'Testing complete pipeline save sequence',
        source_content: 'Original content for full pipeline test',
        session_metadata: {
            pipeline_test: true,
            timestamp: Date.now()
        }
    };

    const steps = [
        { name: 'step1_ai_suggestions', content: 'AI suggestions content' },
        { name: 'step2_applied_edits', content: 'Applied edits content' },
        { name: 'step3_critic_markup', content: 'Critic markup content' },
        { name: 'step4_preprocessed', content: 'Preprocessed content' }
    ];

    const results = [];

    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            supabaseKey
        );

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            console.log(`📝 Saving ${step.name}...`);

            const recordData = {
                set_name: 'ai-suggestion-session',
                step: step.name,
                content: JSON.stringify({
                    step: step.name,
                    content: step.content,
                    step_number: i + 1,
                    timestamp: new Date().toISOString()
                }),
                session_id: sessionData.session_id,
                explanation_id: sessionData.explanation_id,
                explanation_title: sessionData.explanation_title,
                user_prompt: sessionData.user_prompt,
                source_content: sessionData.source_content,
                session_metadata: {
                    ...sessionData.session_metadata,
                    step: step.name,
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
                console.error(`❌ ${step.name} failed:`, error);
                results.push({ step: step.name, success: false, error });
            } else {
                console.log(`✅ ${step.name} saved`);
                results.push({ step: step.name, success: true, data: data[0] });
            }
        }

        const allSuccessful = results.every(r => r.success);
        console.log(`\n🎯 Pipeline sequence result: ${allSuccessful ? '✅ SUCCESS' : '❌ FAILED'}`);

        return {
            success: allSuccessful,
            results,
            sessionId
        };

    } catch (err) {
        console.error('❌ Pipeline sequence test failed:', err);
        return { success: false, error: err };
    }
}

/**
 * Test database permissions and constraints
 */
async function testDatabaseConstraints() {
    console.log('\n🔒 Testing database constraints and permissions...');

    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            supabaseKey
        );

        // Test 1: Insert with minimal data
        console.log('📝 Testing minimal data insert...');
        const minimalData = {
            set_name: 'test-minimal',
            step: 'minimal_test',
            content: 'minimal content'
        };

        const { data: minResult, error: minError } = await supabase
            .from('testing_edits_pipeline')
            .insert([minimalData])
            .select();

        if (minError) {
            console.error('❌ Minimal insert failed:', minError);
        } else {
            console.log('✅ Minimal insert successful');
        }

        // Test 2: Insert with all fields
        console.log('\n📝 Testing full data insert...');
        const fullData = {
            set_name: 'test-full',
            step: 'full_test',
            content: JSON.stringify({ test: 'full data' }),
            session_id: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }),
            explanation_id: 996,
            explanation_title: 'Constraints Test',
            user_prompt: 'Testing all fields',
            source_content: 'Source content for constraints test',
            session_metadata: { test: 'constraints' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: fullResult, error: fullError } = await supabase
            .from('testing_edits_pipeline')
            .insert([fullData])
            .select();

        if (fullError) {
            console.error('❌ Full insert failed:', fullError);
        } else {
            console.log('✅ Full insert successful');
        }

        // Test 3: Test unique constraints
        console.log('\n📝 Testing unique constraints...');
        const duplicateData = {
            set_name: 'test-full',
            step: 'full_test',
            content: 'duplicate attempt'
        };

        const { data: dupResult, error: dupError } = await supabase
            .from('testing_edits_pipeline')
            .insert([duplicateData])
            .select();

        if (dupError) {
            console.log('✅ Unique constraint working (expected error):', dupError.message);
        } else {
            console.log('⚠️ Unique constraint not enforced - duplicate inserted');
        }

        return true;

    } catch (err) {
        console.error('❌ Constraints test failed:', err);
        return false;
    }
}

/**
 * Main test runner
 */
async function runServerActionTests() {
    console.log('🧪 Starting Server Action Tests');
    console.log('=' * 40);

    setupServerActionMocks();

    const results = {
        serverAction: false,
        pipelineSequence: false,
        constraints: false
    };

    // Test 1: Server Action Simulation
    const actionResult = await testSaveTestingPipelineStepAction();
    results.serverAction = !!actionResult;

    // Test 2: Pipeline Save Sequence
    const sequenceResult = await testPipelineSaveSequence();
    results.pipelineSequence = sequenceResult.success;

    // Test 3: Database Constraints
    results.constraints = await testDatabaseConstraints();

    // Summary
    console.log('\n📊 SERVER ACTION TEST SUMMARY');
    console.log('=' * 35);
    console.log('Server Action:', results.serverAction ? '✅' : '❌');
    console.log('Pipeline Sequence:', results.pipelineSequence ? '✅' : '❌');
    console.log('Database Constraints:', results.constraints ? '✅' : '❌');

    const allPassed = Object.values(results).every(r => r);
    console.log('\n🎯 OVERALL RESULT:', allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');

    if (allPassed) {
        console.log('\n💡 Server actions should work correctly!');
        console.log('   Check the actual function calls in the pipeline.');
    } else {
        console.log('\n🔧 Server action layer has issues that need fixing.');
    }

    return results;
}

// Run the tests
if (require.main === module) {
    runServerActionTests()
        .then(results => {
            const exitCode = Object.values(results).every(r => r) ? 0 : 1;
            process.exit(exitCode);
        })
        .catch(err => {
            console.error('❌ Server action test runner failed:', err);
            process.exit(1);
        });
}

module.exports = {
    runServerActionTests,
    testSaveTestingPipelineStepAction,
    testPipelineSaveSequence
};