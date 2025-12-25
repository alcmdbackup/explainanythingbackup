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

// Mock RequestIdContext
jest.mock('@/lib/requestIdContext', () => ({
  RequestIdContext: {
    run: jest.fn((data, callback) => callback()),
    getRequestId: jest.fn(() => 'mock-request-id'),
    getUserId: jest.fn(() => 'mock-user-id'),
    getSessionId: jest.fn(() => 'mock-session-id'),
  },
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}));

import { runAllTests, formatTestResults } from '@/editorFiles/markdownASTdiff/testRunner';
import { RequestIdContext } from '@/lib/requestIdContext';

const mockRunAllTests = runAllTests as jest.MockedFunction<typeof runAllTests>;
const mockFormatTestResults = formatTestResults as jest.MockedFunction<typeof formatTestResults>;
const mockRequestIdContextRun = RequestIdContext.run as jest.MockedFunction<typeof RequestIdContext.run>;

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
    const testResults = [{
      testCase: { id: 1, description: 'Test 1', expectedDiff: '', before: 'before', after: 'after' },
      criticMarkup: '{++Test 1++}',
      success: true
    }];
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
      { testCase: { id: 1, description: 'Test 1', expectedDiff: '', before: 'before1', after: 'after1' }, criticMarkup: '{++Test 1++}', success: true },
      { testCase: { id: 2, description: 'Test 2', expectedDiff: '', before: 'before2', after: 'after2' }, criticMarkup: '{--Test 2--}', success: false },
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

  describe('RequestIdContext', () => {
    it('should call RequestIdContext.run with generated requestId and userId', async () => {
      mockReadFileSync.mockReturnValue('Test content');
      mockRunAllTests.mockReturnValue([]);
      mockFormatTestResults.mockReturnValue('Results');

      await GET();

      expect(mockRequestIdContextRun).toHaveBeenCalledTimes(1);
      expect(mockRequestIdContextRun).toHaveBeenCalledWith(
        { requestId: 'test-responses-test-uuid-123', userId: 'test-responses-test-uuid-123' },
        expect.any(Function)
      );
    });
  });
});
