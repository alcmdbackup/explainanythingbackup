// src/app/api/client-logs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';
import { emitLog } from '@/lib/logging/server/otelLogger';

const clientLogFile = join(process.cwd(), 'client.log');
const isDevelopment = process.env.NODE_ENV === 'development';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle batched logs from remoteFlusher
    const logs = body.logs || [body];

    // Extract requestId from first log or generate one
    const firstLog = logs[0] || {};
    const requestIdData = {
      requestId: firstLog.requestId || `client-log-${randomUUID()}`,
      userId: firstLog.userId || `client-log-${randomUUID()}`,
      sessionId: firstLog.data?.sessionId || firstLog.sessionId || 'unknown'
    };

    return await RequestIdContext.run(requestIdData, async () => {
      for (const logEntry of logs) {
        // In development: write to local file
        if (isDevelopment) {
          const logLine = JSON.stringify({
            ...logEntry,
            source: 'client'
          }) + '\n';
          appendFileSync(clientLogFile, logLine);
        }

        // In all environments: send to Grafana via OTLP
        // (otelLogger respects log level policy: prod=error/warn only, dev=all)
        try {
          emitLog(
            logEntry.level || 'INFO',
            logEntry.message || JSON.stringify(logEntry),
            {
              requestId: logEntry.requestId || requestIdData.requestId,
              userId: logEntry.userId || requestIdData.userId,
              sessionId: logEntry.sessionId || requestIdData.sessionId,
              timestamp: logEntry.timestamp,
              ...(logEntry.data || {})
            },
            'client'
          );
        } catch {
          // Silently fail OTLP to avoid breaking the request
        }
      }

      return NextResponse.json({ success: true });
    });
  } catch (error) {
    logger.error('Failed to write client log', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
  }
}