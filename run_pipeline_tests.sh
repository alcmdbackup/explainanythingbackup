#!/bin/bash

# Pipeline Database Testing Script
#
# This script runs comprehensive tests to debug why pipeline stages
# aren't being saved to the Supabase testing_edits_pipeline table

echo "🧪 Pipeline Database Debug Tests"
echo "================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

# Check if required files exist
if [ ! -f ".env.local" ]; then
    echo "❌ .env.local file not found"
    echo "💡 Make sure Supabase environment variables are configured"
    exit 1
fi

# Install required dependencies if not present
if [ ! -d "node_modules/@supabase" ]; then
    echo "📦 Installing Supabase client..."
    npm install @supabase/supabase-js
fi

if [ ! -d "node_modules/dotenv" ]; then
    echo "📦 Installing dotenv..."
    npm install dotenv
fi

echo ""
echo "🔍 Step 1: Testing direct database connection and operations"
echo "-----------------------------------------------------------"
node test_pipeline_database.js

echo ""
echo "⚙️ Step 2: Testing server action functions"
echo "-------------------------------------------"
node test_server_actions.js

echo ""
echo "📊 Step 3: Checking current database state"
echo "-------------------------------------------"

# Create a quick database check script
cat > check_database_state.js << 'EOF'
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDatabaseState() {
    try {
        // Check total records
        const { count, error } = await supabase
            .from('testing_edits_pipeline')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('❌ Count query failed:', error);
            return;
        }

        console.log(`📊 Total records in table: ${count}`);

        // Check recent records
        const { data: recent, error: recentError } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        if (recentError) {
            console.error('❌ Recent records query failed:', recentError);
            return;
        }

        console.log(`📋 Recent records (${recent.length}):`);
        recent.forEach((record, i) => {
            console.log(`  ${i + 1}. ${record.set_name}/${record.step} (${record.created_at})`);
        });

        // Check for ai-suggestion-session records
        const { data: aiSessions, error: aiError } = await supabase
            .from('testing_edits_pipeline')
            .select('*')
            .eq('set_name', 'ai-suggestion-session')
            .order('created_at', { ascending: false })
            .limit(10);

        if (aiError) {
            console.error('❌ AI session query failed:', aiError);
            return;
        }

        console.log(`🤖 AI suggestion session records: ${aiSessions.length}`);
        if (aiSessions.length > 0) {
            console.log('   Most recent AI sessions:');
            aiSessions.slice(0, 3).forEach((record, i) => {
                console.log(`     ${i + 1}. ${record.session_id} - ${record.step}`);
            });
        } else {
            console.log('   ⚠️ No AI suggestion session records found');
        }

    } catch (err) {
        console.error('❌ Database state check failed:', err);
    }
}

checkDatabaseState().then(() => process.exit(0));
EOF

node check_database_state.js

# Cleanup
rm check_database_state.js

echo ""
echo "🎯 TESTING COMPLETE"
echo "==================="
echo ""
echo "💡 Next Steps:"
echo "   1. Review test results above"
echo "   2. If database tests pass but pipeline doesn't save:"
echo "      - Check if the enhanced pipeline is actually being called"
echo "      - Verify session data is being passed correctly"
echo "      - Look for errors in server logs during AI suggestions"
echo "   3. If database tests fail:"
echo "      - Check Supabase credentials and permissions"
echo "      - Verify table schema matches expectations"
echo "      - Review any error messages above"
echo ""
echo "📋 Test files created:"
echo "   - test_pipeline_database.js (direct database testing)"
echo "   - test_server_actions.js (server action simulation)"
echo "   - run_pipeline_tests.sh (this test runner)"
echo ""
echo "🧹 To clean up test records:"
echo "   node test_pipeline_database.js --cleanup"