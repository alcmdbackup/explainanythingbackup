import { setupServerModuleInterception } from './autoServerLoggingModuleInterceptor';
import * as baseModule from './automaticServerLoggingBase';

// Mock dependencies
jest.mock('./automaticServerLoggingBase');

const mockWithLogging = baseModule.withLogging as jest.MockedFunction<typeof baseModule.withLogging>;
const mockShouldSkipAutoLogging = baseModule.shouldSkipAutoLogging as jest.MockedFunction<typeof baseModule.shouldSkipAutoLogging>;

describe('autoServerLoggingModuleInterceptor', () => {
  let Module: any;
  let originalModuleLoad: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockWithLogging.mockImplementation((fn: any) => {
      const wrapped = (...args: any[]) => fn(...args);
      Object.defineProperty(wrapped, '__isWrapped', { value: true });
      return wrapped as any;
    });

    mockShouldSkipAutoLogging.mockImplementation((fn: any, name: string, context?: 'module' | 'runtime') => {
      // Skip framework code
      if (name.includes('node_modules')) return true;
      if (name.includes('react') && !name.startsWith('@/')) return true;
      if (name.includes('next/') && !name.startsWith('@/')) return true;
      // Allow application code
      if (name.startsWith('@/')) return false;
      if (name.startsWith('./src/')) return false;
      if (name.startsWith('../src/')) return false;
      // Skip everything else
      return true;
    });

    // Get Node Module object
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Module = require('module');
    originalModuleLoad = Module._load;
  });

  afterEach(() => {
    // Restore
    if (originalModuleLoad) {
      Module._load = originalModuleLoad;
    }
  });

  describe('Module._load patching', () => {
    it('should patch Module._load', () => {
      const beforeLoad = Module._load;
      setupServerModuleInterception();

      expect(Module._load).not.toBe(beforeLoad);
      expect(typeof Module._load).toBe('function');
    });

    it('should call withLogging for application module function exports', () => {
      // Mock original load
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).toHaveBeenCalledWith(
        testFn,
        '@/lib/test.testFunc',
        expect.objectContaining({
          enabled: true,
          logInputs: true,
          logOutputs: false,
        })
      );
    });

    it('should not wrap framework module exports', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === 'react') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('react', null, false);

      expect(mockWithLogging).not.toHaveBeenCalled();
    });

    it('should not wrap node_modules', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request.includes('node_modules')) return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('node_modules/package', null, false);

      expect(mockWithLogging).not.toHaveBeenCalled();
    });
  });

  describe('Export wrapping behavior', () => {
    it('should wrap default function exports', () => {
      const defaultFn = jest.fn();
      const mockExports = { default: defaultFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).toHaveBeenCalledWith(
        defaultFn,
        '@/lib/test.default',
        expect.any(Object)
      );
    });

    it('should wrap named function exports', () => {
      const fn1 = jest.fn();
      const fn2 = jest.fn();
      const mockExports = { func1: fn1, func2: fn2 };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).toHaveBeenCalledWith(fn1, '@/lib/test.func1', expect.any(Object));
      expect(mockWithLogging).toHaveBeenCalledWith(fn2, '@/lib/test.func2', expect.any(Object));
    });

    it('should not wrap non-function exports', () => {
      const mockExports = {
        string: 'value',
        number: 42,
        object: {},
      };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).not.toHaveBeenCalled();
    });

    it('should handle mixed exports', () => {
      const defaultFn = jest.fn();
      const namedFn = jest.fn();
      const mockExports = {
        default: defaultFn,
        namedFunc: namedFn,
        nonFunc: 'value',
      };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).toHaveBeenCalledTimes(2);
      expect(mockWithLogging).toHaveBeenCalledWith(defaultFn, '@/lib/test.default', expect.any(Object));
      expect(mockWithLogging).toHaveBeenCalledWith(namedFn, '@/lib/test.namedFunc', expect.any(Object));
    });

    it('should handle empty exports', () => {
      const mockExports = {};

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).not.toHaveBeenCalled();
    });
  });

  describe('Logging configuration', () => {
    it('should use correct config for wrapped functions', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).toHaveBeenCalledWith(
        testFn,
        '@/lib/test.testFunc',
        {
          enabled: true,
          logInputs: true,
          logOutputs: false,
          logErrors: true,
          maxInputLength: 200,
          sensitiveFields: ['password', 'apiKey', 'token', 'secret'],
        }
      );
    });

    it('should disable output logging', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      const config = mockWithLogging.mock.calls[0]?.[2];
      expect(config!.logOutputs).toBe(false);
    });

    it('should enable input logging', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      const config = mockWithLogging.mock.calls[0]?.[2];
      expect(config!.logInputs).toBe(true);
    });

    it('should limit input length', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      const config = mockWithLogging.mock.calls[0]?.[2];
      expect(config!.maxInputLength).toBe(200);
    });

    it('should include sensitive field filtering', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      const config = mockWithLogging.mock.calls[0]?.[2];
      expect(config!.sensitiveFields).toEqual(['password', 'apiKey', 'token', 'secret']);
    });
  });

  describe('WeakSet duplicate prevention', () => {
    it('should not wrap the same function twice', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();

      // Load twice
      Module._load('@/lib/test', null, false);
      const callCount1 = mockWithLogging.mock.calls.length;

      Module._load('@/lib/test', null, false);
      const callCount2 = mockWithLogging.mock.calls.length;

      // Should only wrap once
      expect(callCount1).toBe(1);
      expect(callCount2).toBe(1); // No new calls
    });
  });

  describe('shouldSkipAutoLogging integration', () => {
    it('should skip functions that shouldSkipAutoLogging flags', () => {
      mockShouldSkipAutoLogging.mockReturnValue(true);

      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockWithLogging).not.toHaveBeenCalled();
    });

    it('should pass module context to shouldSkipAutoLogging', () => {
      const testFn = jest.fn();
      const mockExports = { testFunc: testFn };

      Module._load = jest.fn((request: string, ...args: unknown[]) => {
        if (request === '@/lib/test') return mockExports;
        return originalModuleLoad(request, ...args);
      });

      setupServerModuleInterception();
      Module._load('@/lib/test', null, false);

      expect(mockShouldSkipAutoLogging).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(String),
        'module'
      );
    });
  });

});

