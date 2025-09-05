import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runAllTests, formatTestResults } from './testRunner';

/**
 * Generates test responses by running all test cases and saving results to test_responses.txt
 * This script can be run from the command line or imported by other modules
 */
export function generateTestResponses(): void {
  try {
    // Read test cases from file
    const testCasesPath = join(__dirname, 'test_cases.txt');
    const testCasesContent = readFileSync(testCasesPath, 'utf-8');
    
    console.log('Running all test cases...');
    
    // Run all tests
    const results = runAllTests(testCasesContent);
    
    // Format results
    const formattedResults = formatTestResults(results);
    
    // Write to test_responses.txt
    const outputPath = join(__dirname, 'test_responses.txt');
    writeFileSync(outputPath, formattedResults, 'utf-8');
    
    console.log(`✅ Test results saved to: ${outputPath}`);
    console.log(`📊 Summary: ${results.filter(r => r.success).length}/${results.length} tests passed`);
    
    // Log any failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.log('\n❌ Failed tests:');
      failures.forEach(failure => {
        console.log(`  - Test ${failure.testCase.id}: ${failure.error}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error generating test responses:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  generateTestResponses();
}
