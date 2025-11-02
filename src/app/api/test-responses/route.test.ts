/**
 * @jest-environment node
 */

import { GET } from './route';
import { readFileSync, writeFileSync } from 'fs';
import { NextResponse } from 'next/server';

// Mock fs module
jest.mock('fs');
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;

// Mock testRunner utilities
jest.mock('@/editorFiles/markdownASTdiff/testRunner', () => ({
  runAllTests: jest.fn(),
  formatTestResults: jest.fn(),
}));

import { runAllTests, formatTestResults } from '@/editorFiles/markdownASTdiff/testRunner';

const mockRunAllTests = runAllTests as jest.MockedFunction<typeof runAllTests>;
const mockFormatTestResults = formatTestResults as jest.MockedFunction<typeof formatTestResults>;

describe('GET /api/test-responses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to default
    mockReadFileSync.mockReturnValue('');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue('');
  });

  it('should run tests and return formatted results', async () => {
    const testCases = 'Test case 1\nTest case 2';
    const testResults = [{ passed: true, name: 'Test 1' }];
    const formattedResults = 'PASSED: Test 1';

    mockReadFileSync.mockReturnValue(testCases);
    mockRunAllTests.mockReturnValue(testResults);
    mockFormatTestResults.mockReturnValue(formattedResults);

    const response = await GET();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.status).toBe(200);

    // Verify the formatted results were written
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.any(String),
      formattedResults,
      'utf-8'
    );
  });

  it('should read from correct test cases file', async () => {
    const testCases = 'Test cases';
    mockReadFileSync.mockReturnValue(testCases);
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue('Results');

    await GET();

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('src/editorFiles/markdownASTdiff/test_cases.txt'),
      'utf-8'
    );
  });

  it('should call runAllTests with test cases content', async () => {
    const testCases = 'Test case content';
    mockReadFileSync.mockReturnValue(testCases);
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue('Results');

    await GET();

    expect(mockRunAllTests).toHaveBeenCalledWith(testCases);
  });

  it('should format test results', async () => {
    const testResults = [
      { passed: true, name: 'Test 1' },
      { passed: false, name: 'Test 2' },
    ];
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockReturnValue(testResults);
    mockFormatTestResults.mockReturnValue('Formatted');

    await GET();

    expect(mockFormatTestResults).toHaveBeenCalledWith(testResults);
  });

  it('should write results to output file', async () => {
    const formattedResults = 'Test results output';
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue(formattedResults);

    await GET();

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('src/editorFiles/markdownASTdiff/test_responses.txt'),
      formattedResults,
      'utf-8'
    );
  });

  it('should handle file read errors', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });

    const response = await GET();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to generate test responses' });
  });

  it('should handle test execution errors', async () => {
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockImplementation(() => {
      throw new Error('Test execution failed');
    });

    const response = await GET();

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to generate test responses' });
  });

  it('should handle formatting errors', async () => {
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockImplementation(() => {
      throw new Error('Formatting failed');
    });

    const response = await GET();

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to generate test responses' });
  });

  it('should handle file write errors', async () => {
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue('Results');
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('Write failed');
    });

    const response = await GET();

    expect(response.status).toBe(500);

    const json = await response.json();
    expect(json).toEqual({ error: 'Failed to generate test responses' });
  });

  it('should handle empty test cases', async () => {
    mockReadFileSync.mockReturnValue('');
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue('No results');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.any(String),
      'No results',
      'utf-8'
    );
  });

  it('should handle large test output', async () => {
    const largeOutput = 'A'.repeat(100000);
    mockReadFileSync.mockReturnValue('Cases');
    mockRunAllTests.mockReturnValue([]);
    mockFormatTestResults.mockReturnValue(largeOutput);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.any(String),
      largeOutput,
      'utf-8'
    );
  });

  it('should execute full pipeline in correct order', async () => {
    const callOrder: string[] = [];

    mockReadFileSync.mockImplementation(() => {
      callOrder.push('read');
      return 'cases';
    });
    mockRunAllTests.mockImplementation(() => {
      callOrder.push('run');
      return [];
    });
    mockFormatTestResults.mockImplementation(() => {
      callOrder.push('format');
      return 'results';
    });
    mockWriteFileSync.mockImplementation(() => {
      callOrder.push('write');
    });

    await GET();

    expect(callOrder).toEqual(['read', 'run', 'format', 'write']);
  });
});
