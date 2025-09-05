import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runAllTests, formatTestResults } from '@/editorFiles/markdownASTdiff/testRunner';

export async function GET() {
  try {
    // Read test cases
    const testCasesPath = join(process.cwd(), 'src/editorFiles/markdownASTdiff/test_cases.txt');
    const testCasesContent = readFileSync(testCasesPath, 'utf-8');
    
    // Run all tests
    const results = runAllTests(testCasesContent);
    
    // Format results
    const formattedResults = formatTestResults(results);
    
    // Write to test_responses.txt
    const outputPath = join(process.cwd(), 'src/editorFiles/markdownASTdiff/test_responses.txt');
    writeFileSync(outputPath, formattedResults, 'utf-8');
    
    return new NextResponse(formattedResults, {
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error('Error generating test responses:', error);
    return NextResponse.json(
      { error: 'Failed to generate test responses' },
      { status: 500 }
    );
  }
}
