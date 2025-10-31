'use client';

import { useState, useEffect } from 'react';

export default function TestClientLogging() {
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  // This function will be automatically wrapped by runtime interception
  const handleButtonClick = () => {
    console.log('Button clicked - this should be logged automatically');
    setMessage('Button was clicked at ' + new Date().toISOString());

    // Test various APIs that should trigger logging
    setTimeout(() => {
      console.log('Timeout callback executed');
    }, 100);

    // Test promise chain
    Promise.resolve('test data')
      .then(data => {
        console.log('Promise resolved with:', data);
        return data.toUpperCase();
      })
      .then(upperData => {
        console.log('Promise chain completed:', upperData);
      });

    // Test fetch (should be intercepted)
    fetch('/api/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Manual test log from button click',
        data: { userAction: 'button-click', component: 'TestClientLogging' },
        requestId: `test-${Date.now()}`,
        source: 'manual-test'
      })
    }).then(() => {
      console.log('Manual log sent successfully');
    });
  };

  // Test useEffect (should trigger logging)
  useEffect(() => {
    console.log('Component mounted - useEffect triggered');
    setLogs(prev => [...prev, 'Component mounted']);
  }, []);

  // Test async function
  const handleAsyncAction = async () => {
    console.log('Starting async action');

    try {
      const data = await new Promise(resolve =>
        setTimeout(() => resolve('async data'), 500)
      );
      console.log('Async action completed:', data);
      setLogs(prev => [...prev, `Async completed: ${data}`]);
    } catch (error) {
      console.error('Async action failed:', error);
    }
  };

  // Test DOM manipulation
  const handleDOMTest = () => {
    console.log('Testing DOM operations');

    // These should trigger DOM interception
    const element = document.querySelector('#test-element');
    const elements = document.querySelectorAll('.test-class');
    const byId = document.getElementById('test-element');

    console.log('DOM queries completed', { element, elements: elements.length, byId });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Client Logging Test Page</h1>

      <div className="space-y-4">
        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Test Runtime Interception</h2>
          <p className="text-gray-600 mb-4">
            These buttons will trigger various browser APIs that should be automatically logged
            by the runtime interception system.
          </p>

          <div className="space-x-2">
            <button
              onClick={handleButtonClick}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Test Event Handler
            </button>

            <button
              onClick={handleAsyncAction}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Test Async Action
            </button>

            <button
              onClick={handleDOMTest}
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
            >
              Test DOM Operations
            </button>
          </div>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Current Status</h2>
          <p className="text-sm text-gray-600">Message: {message || 'No interactions yet'}</p>

          <div className="mt-4">
            <h3 className="font-medium">Local Logs:</h3>
            <ul className="text-sm text-gray-600">
              {logs.map((log, index) => (
                <li key={index}>• {log}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="p-4 border rounded-lg bg-yellow-50">
          <h2 className="text-xl font-semibold mb-2">How to Verify Logging</h2>
          <ol className="list-decimal list-inside text-sm space-y-1">
            <li>Open browser developer tools and check console for initialization messages</li>
            <li>Click the buttons above to trigger various browser APIs</li>
            <li>Check the terminal running the dev server for client log entries</li>
            <li>Look for client.log file in the project root with automated logs</li>
            <li>Verify that Promise chains, timeouts, and fetch calls are being intercepted</li>
          </ol>
        </div>

        {/* Test elements for DOM operations */}
        <div id="test-element" className="test-class hidden">
          Test element for DOM queries
        </div>
      </div>
    </div>
  );
}