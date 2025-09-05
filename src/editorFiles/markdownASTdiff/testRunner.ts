import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { diffMdast, renderCriticMarkup } from './markdownASTdiff';

export interface TestCase {
  id: number;
  description: string;
  expectedDiff: string;
  before: string;
  after: string;
}

export interface TestResult {
  testCase: TestCase;
  diffOps: any[];
  criticMarkup: string;
  success: boolean;
  error?: string;
}

/**
 * Parses test cases from the test_cases.txt file format
 * Extracts numbered test cases with before/after markdown content
 */
export function parseTestCases(testCasesContent: string): TestCase[] {
  const testCases: TestCase[] = [];
  const lines = testCasesContent.split('\n');
  
  let currentTestCase: Partial<TestCase> = {};
  let currentSection = '';
  let currentContent: string[] = [];
  let inCodeBlock = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match test case header: "## Test Case X: Description"
    const testCaseMatch = line.match(/^## Test Case (\d+): (.+)$/);
    if (testCaseMatch) {
      // Save previous test case if exists
      if (currentTestCase.id) {
        testCases.push(currentTestCase as TestCase);
      }
      
      // Start new test case
      currentTestCase = {
        id: parseInt(testCaseMatch[1]),
        description: testCaseMatch[2],
        before: '',
        after: '',
        expectedDiff: ''
      };
      currentSection = '';
      currentContent = [];
      inCodeBlock = false;
      continue;
    }
    
    // Match description line
    if (line.startsWith('**Description**:')) {
      currentTestCase.description = line.replace('**Description**:', '').trim();
      continue;
    }
    
    // Match expected diff line
    if (line.startsWith('**Expected Diff**:')) {
      currentTestCase.expectedDiff = line.replace('**Expected Diff**:', '').trim();
      continue;
    }
    
    // Match section headers
    if (line.startsWith('### Before:')) {
      currentSection = 'before';
      currentContent = [];
      inCodeBlock = false;
      continue;
    }
    
    if (line.startsWith('### After:')) {
      currentSection = 'after';
      currentContent = [];
      inCodeBlock = false;
      continue;
    }
    
    // Handle code block markers
    if (currentSection && line.startsWith('```')) {
      if (!inCodeBlock) {
        // Opening code block
        inCodeBlock = true;
        currentContent = [];
      } else {
        // Closing code block
        inCodeBlock = false;
        const content = currentContent.join('\n');
        if (currentSection === 'before') {
          currentTestCase.before = content;
        } else if (currentSection === 'after') {
          currentTestCase.after = content;
        }
        currentSection = '';
        currentContent = [];
      }
      continue;
    }
    
    // Collect content lines within code blocks
    if (currentSection && inCodeBlock) {
      currentContent.push(line);
    }
  }
  
  // Don't forget the last test case
  if (currentTestCase.id) {
    testCases.push(currentTestCase as TestCase);
  }
  
  return testCases;
}

/**
 * Runs a single test case through the diffMdast function
 * Returns detailed results including diff operations and critic markup
 */
export function runSingleTest(testCase: TestCase): TestResult {
  try {
    // Parse markdown strings into AST
    const beforeAST = unified().use(remarkParse).parse(testCase.before);
    const afterAST = unified().use(remarkParse).parse(testCase.after);
    
    // Compute the diff using markdownASTdiff
    const diffOps = diffMdast(beforeAST, afterAST, { 
      textGranularity: 'word' 
    });
    
    // Generate CriticMarkup output
    const criticMarkup = renderCriticMarkup(beforeAST, afterAST, {
      textGranularity: 'word'
    });
    
    return {
      testCase,
      diffOps,
      criticMarkup,
      success: true
    };
  } catch (error) {
    return {
      testCase,
      diffOps: [],
      criticMarkup: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Runs all test cases and returns comprehensive results
 * Processes each test case and generates detailed diff outputs
 */
export function runAllTests(testCasesContent: string): TestResult[] {
  const testCases = parseTestCases(testCasesContent);
  return testCases.map(runSingleTest);
}

/**
 * Formats test results into a readable markdown output with CriticMarkup rendering
 * Creates structured output suitable for saving to test_responses.txt
 */
export function formatTestResults(results: TestResult[]): string {
  let output = '# Markdown AST Diff Test Results\n\n';
  output += `Generated on: ${new Date().toISOString()}\n`;
  output += `Total tests: ${results.length}\n`;
  output += `Successful: ${results.filter(r => r.success).length}\n`;
  output += `Failed: ${results.filter(r => !r.success).length}\n\n`;
  
  results.forEach((result, index) => {
    output += `## Test Case ${result.testCase.id}: ${result.testCase.description}\n\n`;
    
    if (!result.success) {
      output += `❌ **FAILED**: ${result.error}\n\n`;
      return;
    }
    
    output += `✅ **SUCCESS**\n\n`;
    output += `**Expected Diff**: ${result.testCase.expectedDiff}\n\n`;
    
    output += `**Before:**\n\`\`\`\n${result.testCase.before}\n\`\`\`\n\n`;
    output += `**After:**\n\`\`\`\n${result.testCase.after}\n\`\`\`\n\n`;
    
    output += `**Diff Operations Count**: ${result.diffOps.length}\n\n`;
    
    // Render the CriticMarkup as markdown instead of showing raw JSON
    output += `**Rendered Diff with CriticMarkup:**\n\n`;
    output += `${result.criticMarkup}\n\n`;
    
    // Add a note about the CriticMarkup syntax
    output += `> **Note**: The diff above uses CriticMarkup syntax where:\n`;
    output += `> - \`{--deleted text--}\` shows removed content\n`;
    output += `> - \`{++inserted text++}\` shows added content\n`;
    output += `> - Regular text remains unchanged\n\n`;
    
    output += '---\n\n';
  });
  
  return output;
}
