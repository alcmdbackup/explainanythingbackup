import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/server_utilities';

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
    logger.error('Error reading test cases', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Failed to read test cases' },
      { status: 500 }
    );
  }
}
