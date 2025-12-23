// src/app/api/client-logs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/server_utilities';

const clientLogFile = join(process.cwd(), 'client.log');

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Client logging only available in development' }, { status: 403 });
  }

  try {
    const logEntry = await request.json();

    // Append to client.log file
    const logLine = JSON.stringify({
      ...logEntry,
      source: 'client'
    }) + '\n';

    appendFileSync(clientLogFile, logLine);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to write client log', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
  }
}