// src/lib/logging/client/validateImplementation.ts

/**
 * Validation script to ensure client logging implementation is working correctly
 * Run this after implementing the client logging system
 */

import { withClientLogging, shouldWrapFunction } from './safeClientLoggingBase';
import { createSafeEventHandler, createSafeAsyncFunction, logUserAction } from './safeUserCodeWrapper';

export function validateClientLoggingImplementation() {
  console.log('🧪 Validating Client Logging Implementation...\n');

  let testsPassed = 0;
  let testsTotal = 0;

  function test(name: string, testFn: () => boolean | Promise<boolean>) {
    testsTotal++;
    try {
      const result = testFn();
      if (result instanceof Promise) {
        result.then(passed => {
          if (passed) {
            console.log(`✅ ${name}`);
            testsPassed++;
          } else {
            console.log(`❌ ${name}`);
          }
        });
      } else {
        if (result) {
          console.log(`✅ ${name}`);
          testsPassed++;
        } else {
          console.log(`❌ ${name}`);
        }
      }
    } catch (error) {
      console.log(`❌ ${name} - Error: ${error.message}`);
    }
  }

  // Test 1: Basic wrapper functionality
  test('Basic function wrapping works', () => {
    const testFn = () => 'test result';
    const wrapped = withClientLogging(testFn, 'testFunction');
    return wrapped() === 'test result';
  });

  // Test 2: Development vs Production behavior
  test('Production mode disables logging', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const testFn = () => 'test';
    const wrapped = withClientLogging(testFn, 'prodTest');
    const isDisabled = wrapped === testFn; // Should return original function

    process.env.NODE_ENV = originalEnv;
    return isDisabled;
  });

  // Test 3: System code rejection
  test('System code rejection works', () => {
    const systemFunction = () => {
      fetch('/api/test'); // Contains fetch - should be rejected
      return 'system';
    };
    return !shouldWrapFunction(systemFunction, 'systemTest', '/src/test.ts');
  });

  // Test 4: User code acceptance
  test('User code acceptance works', () => {
    const userFunction = function userBusinessLogic() {
      return 'user code that does business logic';
    };
    return shouldWrapFunction(userFunction, 'userBusinessLogic', '/src/components/Test.tsx');
  });

  // Test 5: Safe event handler creation
  test('Safe event handler creation works', () => {
    const handler = () => 'handled';
    const wrapped = createSafeEventHandler(handler, 'testHandler');
    return typeof wrapped === 'function';
  });

  // Test 6: Safe async function creation
  test('Safe async function creation works', () => {
    const asyncFn = async () => 'async result';
    const wrapped = createSafeAsyncFunction(asyncFn, 'testAsync');
    return typeof wrapped === 'function';
  });

  // Test 7: Manual logging works
  test('Manual user action logging works', () => {
    try {
      logUserAction('test_action', { test: true });
      return true;
    } catch {
      return false;
    }
  });

  // Test 8: Circular reference handling
  test('Circular reference handling works', () => {
    const obj: any = { name: 'test' };
    obj.self = obj; // Circular reference

    const wrappedFn = withClientLogging(() => obj, 'circularTest');
    try {
      const result = wrappedFn();
      return result !== null && result !== undefined;
    } catch {
      return false;
    }
  });

  // Test 9: Error handling
  test('Error handling works correctly', () => {
    const errorFn = () => {
      throw new Error('Test error');
    };

    const wrapped = withClientLogging(errorFn, 'errorTest');
    try {
      wrapped();
      return false; // Should have thrown
    } catch (error) {
      return error.message === 'Test error';
    }
  });

  // Test 10: Async error handling
  test('Async error handling works correctly', async () => {
    const asyncErrorFn = async () => {
      throw new Error('Async test error');
    };

    const wrapped = withClientLogging(asyncErrorFn, 'asyncErrorTest');
    try {
      await wrapped();
      return false; // Should have thrown
    } catch (error) {
      return error.message === 'Async test error';
    }
  });

  // Summary
  setTimeout(() => {
    console.log(`\n📊 Validation Summary: ${testsPassed}/${testsTotal} tests passed`);

    if (testsPassed === testsTotal) {
      console.log('🎉 All tests passed! Client logging implementation is working correctly.');
      console.log('\n🚀 Next steps:');
      console.log('1. Start your development server: npm run dev');
      console.log('2. Check that client.log file appears in your project root');
      console.log('3. Test logging in your components using the wrapper functions');
      console.log('4. Use tail -f client.log to monitor logs in real-time');
    } else {
      console.log('⚠️ Some tests failed. Please check the implementation.');
      console.log('\n🔧 Troubleshooting:');
      console.log('1. Ensure all files are in the correct locations');
      console.log('2. Check that NODE_ENV is set to "development"');
      console.log('3. Verify that @/lib/client_utilities exports a logger');
      console.log('4. Run: npm test src/lib/logging/client/__tests__/');
    }
  }, 100);
}

// Export for manual testing
export function runValidation() {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    validateClientLoggingImplementation();
  } else {
    console.log('Validation skipped - not in development environment or not in browser');
  }
}