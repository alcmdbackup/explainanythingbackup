import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Read test cases from the markdownASTdiff directory
    const testCasesPath = join(process.cwd(), 'src/editorFiles/markdownASTdiff/test_cases.txt');
    const testCasesContent = readFileSync(testCasesPath, 'utf-8');
    
    return new NextResponse(testCasesContent, {
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error('Error reading test cases:', error);
    return NextResponse.json(
      { error: 'Failed to read test cases' },
      { status: 500 }
    );
  }
}
