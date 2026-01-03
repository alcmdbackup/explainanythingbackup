/**
 * Health Check API Endpoint
 *
 * Validates that the application and its dependencies are functioning correctly.
 * Used for:
 * - Load balancer health checks
 * - Post-deployment validation
 * - Monitoring and alerting
 *
 * Returns 200 if all checks pass, 503 if any critical check fails.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Required tag IDs for "Rewrite with tags" functionality
const REQUIRED_TAG_IDS = [2, 5];

// Timeout for database queries to prevent hanging (in seconds for Supabase)
const QUERY_TIMEOUT_SECONDS = 10;

interface TagRow {
  id: number;
  tag_name: string;
}

interface HealthCheck {
  status: 'pass' | 'fail';
  message?: string;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: {
    database: HealthCheck;
    requiredTags: HealthCheck;
    environment: HealthCheck;
  };
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const checks: HealthResponse['checks'] = {
    database: { status: 'fail' },
    requiredTags: { status: 'fail' },
    environment: { status: 'fail' },
  };

  // Check 1: Environment variables
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingEnvVars.length === 0) {
    checks.environment = { status: 'pass' };
  } else {
    checks.environment = {
      status: 'fail',
      message: `Missing environment variables: ${missingEnvVars.join(', ')}`,
    };
  }

  // Check 2: Database connection
  try {
    // Create Supabase client with global fetch timeout
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          fetch: (url, options) =>
            fetch(url, {
              ...options,
              signal: AbortSignal.timeout(QUERY_TIMEOUT_SECONDS * 1000),
            }),
        },
      }
    );

    // Simple query to verify connection
    const { error: dbError } = await supabase.from('tags').select('id').limit(1);

    if (dbError) {
      checks.database = {
        status: 'fail',
        message: `Database query failed: ${dbError.message}`,
      };
    } else {
      checks.database = { status: 'pass' };
    }

    // Check 3: Required tags exist (needed for "Rewrite with tags" feature)
    const { data: tags, error: tagsError } = await supabase
      .from('tags')
      .select('id, tag_name')
      .in('id', REQUIRED_TAG_IDS);

    if (tagsError) {
      checks.requiredTags = {
        status: 'fail',
        message: `Failed to query tags: ${tagsError.message}`,
      };
    } else if (!tags || tags.length < REQUIRED_TAG_IDS.length) {
      const foundIds = (tags as TagRow[])?.map((t) => t.id) || [];
      const missingIds = REQUIRED_TAG_IDS.filter((id) => !foundIds.includes(id));
      checks.requiredTags = {
        status: 'fail',
        message: `Missing required tags with IDs: ${missingIds.join(', ')}`,
        details: {
          required: REQUIRED_TAG_IDS,
          found: foundIds,
          missing: missingIds,
        },
      };
    } else {
      checks.requiredTags = {
        status: 'pass',
        details: {
          tags: (tags as TagRow[]).map((t) => ({ id: t.id, name: t.tag_name })),
        },
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Check for timeout errors
    const isTimeout = errorMessage.includes('abort') || errorMessage.includes('timeout');
    checks.database = {
      status: 'fail',
      message: isTimeout
        ? `Database query timed out after ${QUERY_TIMEOUT_SECONDS}s`
        : `Database connection error: ${errorMessage}`,
    };
  }

  // Determine overall health
  const allPassed = Object.values(checks).every(c => c.status === 'pass');

  const response: HealthResponse = {
    status: allPassed ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(response, {
    status: allPassed ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
