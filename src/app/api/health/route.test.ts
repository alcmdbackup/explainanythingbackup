/**
 * Tests for Health Check API Endpoint
 */

import { GET } from './route';
import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('Health Check API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return healthy status when all checks pass', async () => {
    // Mock successful database queries
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
      in: jest.fn().mockResolvedValue({
        data: [
          { id: 2, tag_name: 'medium' },
          { id: 5, tag_name: 'moderate' },
        ],
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('pass');
    expect(data.checks.requiredTags.status).toBe('pass');
    expect(data.checks.environment.status).toBe('pass');
  });

  it('should return unhealthy status when required tags are missing', async () => {
    // Mock database connection works but tags are missing
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
      in: jest.fn().mockResolvedValue({
        data: [], // No tags found
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database.status).toBe('pass');
    expect(data.checks.requiredTags.status).toBe('fail');
    expect(data.checks.requiredTags.message).toContain('Missing required tags');
    expect(data.checks.requiredTags.details?.missing).toEqual([2, 5]);
  });

  it('should return unhealthy status when only some required tags exist', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
      in: jest.fn().mockResolvedValue({
        data: [{ id: 2, tag_name: 'medium' }], // Only tag 2, missing tag 5
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.requiredTags.status).toBe('fail');
    expect(data.checks.requiredTags.details?.missing).toEqual([5]);
  });

  it('should return unhealthy status when database connection fails', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Connection refused' },
      }),
      in: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Connection refused' },
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.database.status).toBe('fail');
    expect(data.checks.database.message).toContain('Connection refused');
  });

  it('should return unhealthy status when environment variables are missing', async () => {
    // Remove required env vars
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.checks.environment.status).toBe('fail');
    expect(data.checks.environment.message).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('should include timestamp in response', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
      in: jest.fn().mockResolvedValue({
        data: [
          { id: 2, tag_name: 'medium' },
          { id: 5, tag_name: 'moderate' },
        ],
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();
    const data = await response.json();

    expect(data.timestamp).toBeDefined();
    expect(new Date(data.timestamp).getTime()).not.toBeNaN();
  });

  it('should set no-cache headers', async () => {
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null }),
      in: jest.fn().mockResolvedValue({
        data: [
          { id: 2, tag_name: 'medium' },
          { id: 5, tag_name: 'moderate' },
        ],
        error: null,
      }),
    };

    mockCreateClient.mockReturnValue(mockSupabase as any);

    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });
});
