/**
 * @jest-environment node
 */

import { GET } from './route';
import { readFileSync } from 'fs';
import { NextResponse } from 'next/server';

// Mock fs module
jest.mock('fs');
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

// Mock RequestIdContext
jest.mock('@/lib/requestIdContext', () => ({
  RequestIdContext: {
    run: jest.fn((data, callback) => callback()),
    getRequestId: jest.fn(() => 'mock-request-id'),
    getUserId: jest.fn(() => 'mock-user-id'),
  },
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}));

import { RequestIdContext } from '@/lib/requestIdContext';
const mockRequestIdContextRun = RequestIdContext.run as jest.MockedFunction<typeof RequestIdContext.run>;

describe('GET /api/test-cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return test cases content as plain text', async () => {
    const mockContent = 'Test case 1\nTest case 2';
    mockReadFileSync.mockReturnValue(mockContent);

    const response = await GET();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.status).toBe(200);
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it('should read from correct file path', async () => {
    const mockContent = 'Test content';
    mockReadFileSync.mockReturnValue(mockContent);

    await GET();

    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('src/editorFiles/markdownASTdiff/test_cases.txt'),
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
    expect(json).toEqual({ error: 'Failed to read test cases' });
  });

  it('should handle empty file', async () => {
    mockReadFileSync.mockReturnValue('');

    const response = await GET();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(200);
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it('should handle file with special characters', async () => {
    const mockContent = 'Test with **markdown** and `code`\nSpecial chars: <>&"';
    mockReadFileSync.mockReturnValue(mockContent);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it('should handle large files', async () => {
    const mockContent = 'A'.repeat(10000);
    mockReadFileSync.mockReturnValue(mockContent);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  describe('RequestIdContext', () => {
    it('should call RequestIdContext.run with generated requestId and userId', async () => {
      mockReadFileSync.mockReturnValue('Test content');

      await GET();

      expect(mockRequestIdContextRun).toHaveBeenCalledTimes(1);
      expect(mockRequestIdContextRun).toHaveBeenCalledWith(
        { requestId: 'test-cases-test-uuid-123', userId: 'test-cases-test-uuid-123' },
        expect.any(Function)
      );
    });
  });
});
