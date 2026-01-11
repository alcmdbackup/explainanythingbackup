/**
 * OTLP Traces Proxy - Forwards browser traces to the OTLP backend (Honeycomb)
 *
 * This endpoint proxies OpenTelemetry trace data from the browser to the configured
 * OTLP endpoint, bypassing CORS restrictions that block direct browser requests.
 *
 * The browser sends traces here, and we forward them server-side with auth headers.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS;

  if (!endpoint) {
    return NextResponse.json(
      { error: 'OTEL_EXPORTER_OTLP_ENDPOINT not configured' },
      { status: 503 }
    );
  }

  try {
    // Get the raw body (protobuf or JSON)
    const body = await request.arrayBuffer();
    const contentType = request.headers.get('content-type') || 'application/x-protobuf';

    // Parse auth header from OTEL_EXPORTER_OTLP_HEADERS format: "Authorization=Basic xxx"
    const forwardHeaders: Record<string, string> = {
      'Content-Type': contentType,
    };

    if (headers) {
      // Format: "Authorization=Basic xxx" or "key1=value1,key2=value2"
      headers.split(',').forEach((pair) => {
        const [key, ...valueParts] = pair.split('=');
        if (key && valueParts.length > 0) {
          forwardHeaders[key.trim()] = valueParts.join('=').trim();
        }
      });
    }

    // Forward to OTLP backend (Honeycomb)
    const response = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: forwardHeaders,
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[traces-proxy] OTLP backend rejected traces:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to forward traces', details: errorText },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('[traces-proxy] Error forwarding traces:', error);
    return NextResponse.json(
      { error: 'Internal error forwarding traces' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS preflight (browser will send this)
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
