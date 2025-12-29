'use client';

import { useState } from 'react';

interface CorsTestResult {
  preflight: number;
  corsHeaders: {
    'access-control-allow-origin': string | null;
    'access-control-allow-credentials': string | null;
  };
  post: number;
  postOk: boolean;
}

export default function CorsTestPage() {
  const [result, setResult] = useState<string>('Not tested');
  const [isLoading, setIsLoading] = useState(false);

  const testCors = async () => {
    setIsLoading(true);
    const endpoint =
      process.env.NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT ||
      'https://otlp-gateway-prod-us-west-0.grafana.net/otlp';
    const token = process.env.NEXT_PUBLIC_GRAFANA_OTLP_TOKEN;

    if (!token) {
      setResult(
        'ERROR: NEXT_PUBLIC_GRAFANA_OTLP_TOKEN not set.\n\n' +
          'To configure:\n' +
          '1. Go to https://grafana.com/orgs/<org>/stacks/<stack>/otlp-info\n' +
          '2. Get your instance ID and API key\n' +
          '3. Add to .env.local:\n' +
          '   NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=<endpoint>\n' +
          '   NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=<base64(instanceId:apiKey)>'
      );
      setIsLoading(false);
      return;
    }

    try {
      // Test 1: OPTIONS preflight
      const preflight = await fetch(`${endpoint}/v1/traces`, {
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Method': 'POST' },
      });

      const corsHeaders = {
        'access-control-allow-origin': preflight.headers.get(
          'access-control-allow-origin'
        ),
        'access-control-allow-credentials': preflight.headers.get(
          'access-control-allow-credentials'
        ),
      };

      // Test 2: Actual POST with auth
      const postResult = await fetch(`${endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify({ resourceSpans: [] }), // Empty but valid OTLP
      });

      const testResult: CorsTestResult = {
        preflight: preflight.status,
        corsHeaders,
        post: postResult.status,
        postOk: postResult.ok,
      };

      const corsWorks =
        corsHeaders['access-control-allow-origin'] !== null && postResult.ok;

      setResult(
        `${corsWorks ? '✅ CORS WORKS' : '❌ CORS ISSUES'}\n\n` +
          JSON.stringify(testResult, null, 2) +
          '\n\n' +
          (corsWorks
            ? 'Decision: Proceed with Phase 3 (Browser OpenTelemetry)'
            : 'Decision: Implement collector proxy OR pivot to Grafana Faro')
      );
    } catch (e) {
      setResult(
        `❌ CORS BLOCKED\n\nError: ${e instanceof Error ? e.message : String(e)}\n\n` +
          'This typically means:\n' +
          '1. The Grafana OTLP endpoint does not allow browser requests\n' +
          '2. You need to set up a collector proxy\n' +
          '3. Or pivot to Grafana Faro which handles this differently\n\n' +
          'Decision: Cannot use direct browser→Grafana OTLP. Implement proxy or use Faro.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">CORS Test for Grafana OTLP</h1>

      <div className="space-y-4">
        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Phase 0: CORS Validation</h2>
          <p className="text-gray-600 mb-4">
            This test determines if direct browser→Grafana OTLP is viable for
            Phase 3 (Browser OpenTelemetry).
          </p>

          <button
            onClick={testCors}
            disabled={isLoading}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {isLoading ? 'Testing...' : 'Test CORS'}
          </button>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Result</h2>
          <pre className="p-4 bg-gray-100 rounded whitespace-pre-wrap text-sm font-mono">
            {result}
          </pre>
        </div>

        <div className="p-4 border rounded-lg bg-yellow-50">
          <h2 className="text-xl font-semibold mb-2">Environment Setup</h2>
          <p className="text-sm text-gray-600 mb-2">
            Add these to your <code className="bg-gray-200 px-1 rounded">.env.local</code>:
          </p>
          <pre className="p-3 bg-gray-100 rounded text-sm font-mono">
{`# Get from: https://grafana.com/orgs/<org>/stacks/<stack>/otlp-info
NEXT_PUBLIC_GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-west-0.grafana.net/otlp
NEXT_PUBLIC_GRAFANA_OTLP_TOKEN=<base64(instanceId:apiKey)>`}
          </pre>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Decision Tree</h2>
          <ul className="list-disc list-inside text-sm space-y-1">
            <li>
              <span className="text-green-600 font-medium">✅ CORS works</span> →
              Proceed with Phase 3 as planned
            </li>
            <li>
              <span className="text-red-600 font-medium">❌ CORS blocked</span> →
              Implement collector proxy OR pivot to Grafana Faro
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
