// src/lib/logging/client/buildTimeTransformer.ts

import * as babel from '@babel/core';
import { PluginItem } from '@babel/core';

// ONLY transform files in these directories
const USER_CODE_DIRECTORIES = [
  '/src/',           // User source code
  '/app/',           // Next.js app directory
  '/pages/',         // Next.js pages
  '/components/',    // User components
  '/lib/',           // User utilities
  '/utils/'          // User utilities
];

// NEVER transform these paths
const SYSTEM_CODE_BLOCKLIST = [
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  '/__tests__/',
  '.turbo/',
  'webpack:',
  'react',
  'next'
];

interface BabelPluginOptions {
  // Configuration options for the plugin
  enableLogging?: boolean;
  maxFunctionLength?: number;
  skipSystemFunctions?: boolean;
}

/**
 * Babel plugin to automatically wrap user functions with client logging
 */
export function createClientLoggingBabelPlugin(options: BabelPluginOptions = {}): PluginItem {
  const {
    enableLogging = process.env.NODE_ENV === 'development',
    maxFunctionLength = 50,
    skipSystemFunctions = true
  } = options;

  return function({ types: t }: { types: typeof babel.types }): babel.PluginObj {
    return {
      name: 'client-auto-logging',
      visitor: {
        Program(path, state) {
          // Check if this file should be transformed
          const filename = state.filename || '';

          // Skip if not in user code directories
          const isUserCode = USER_CODE_DIRECTORIES.some(dir => filename.includes(dir));
          const isSystemCode = SYSTEM_CODE_BLOCKLIST.some(pattern => filename.includes(pattern));

          if (!enableLogging || !isUserCode || isSystemCode) {
            return;
          }

          // Add import for withClientLogging at the top of the file
          const importDeclaration = t.importDeclaration(
            [t.importSpecifier(t.identifier('withClientLogging'), t.identifier('withClientLogging'))],
            t.stringLiteral('@/lib/logging/client/safeClientLoggingBase')
          );

          path.unshiftContainer('body', importDeclaration);
        },

        // Wrap function declarations
        FunctionDeclaration(path, state) {
          if (!shouldTransformFunction(path, state)) return;

          const func = path.node;
          if (!func.id) return;

          const functionName = func.id.name;
          const wrappedFunction = wrapFunctionWithLogging(t, func, functionName);

          path.replaceWith(wrappedFunction);
        },

        // Wrap arrow function expressions assigned to variables
        VariableDeclarator(path, state) {
          if (!shouldTransformFunction(path, state)) return;

          const { id, init } = path.node;
          if (!t.isIdentifier(id) || !t.isArrowFunctionExpression(init) && !t.isFunctionExpression(init)) {
            return;
          }

          const functionName = id.name;
          const wrappedFunction = wrapFunctionWithLogging(t, init, functionName);

          path.node.init = wrappedFunction;
        },

        // Wrap exported function expressions
        ExportDefaultDeclaration(path, state) {
          if (!shouldTransformFunction(path, state)) return;

          const { declaration } = path.node;
          if (!t.isFunctionExpression(declaration) && !t.isArrowFunctionExpression(declaration)) {
            return;
          }

          const functionName = t.isFunctionExpression(declaration) && declaration.id
            ? declaration.id.name
            : 'defaultExport';

          const wrappedFunction = wrapFunctionWithLogging(t, declaration, functionName);
          path.node.declaration = wrappedFunction;
        }
      }
    };
  };

  function shouldTransformFunction(path: any, state: any): boolean {
    const filename = state.filename || '';

    // Skip if not in user code directories
    const isUserCode = USER_CODE_DIRECTORIES.some(dir => filename.includes(dir));
    const isSystemCode = SYSTEM_CODE_BLOCKLIST.some(pattern => filename.includes(pattern));

    if (!enableLogging || !isUserCode || isSystemCode) {
      return false;
    }

    // Skip very small functions (likely not substantial user code)
    const code = path.toString();
    if (code.length < maxFunctionLength) {
      return false;
    }

    // Skip React hooks and system patterns
    const func = path.node;
    const name = getFunctionName(func);

    if (skipSystemFunctions && isSystemFunction(name, code)) {
      return false;
    }

    return true;
  }

  function wrapFunctionWithLogging(t: typeof babel.types, func: any, functionName: string) {
    // Create the wrapped function call
    // withClientLogging(originalFunction, functionName, config)
    return t.callExpression(
      t.identifier('withClientLogging'),
      [
        func,
        t.stringLiteral(functionName),
        t.objectExpression([
          t.objectProperty(t.identifier('functionType'), t.stringLiteral('userFunction')),
          t.objectProperty(t.identifier('enabled'), t.booleanLiteral(true)),
          t.objectProperty(t.identifier('logInputs'), t.booleanLiteral(true)),
          t.objectProperty(t.identifier('logOutputs'), t.booleanLiteral(false))
        ])
      ]
    );
  }

  function getFunctionName(func: any): string {
    if (func.id && func.id.name) {
      return func.id.name;
    }
    return 'anonymous';
  }

  function isSystemFunction(name: string, code: string): boolean {
    // System function patterns to exclude
    const systemPatterns = [
      /^use[A-Z]/,        // React hooks
      /^__webpack/,       // Webpack internals
      /^__next/,          // Next.js internals
      /^React\./,         // React methods
      /scheduler/,        // React scheduler
      /node_modules/      // Dependencies
    ];

    // Check if function name or code matches system patterns
    if (systemPatterns.some(pattern => pattern.test(name) || pattern.test(code))) {
      return true;
    }

    // Check if function uses logging system APIs (would cause recursion)
    const loggingSystemAPIs = [
      'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval',
      'addEventListener', 'console', 'JSON.stringify', 'performance.now'
    ];

    if (loggingSystemAPIs.some(api => code.includes(api))) {
      return true;
    }

    return false;
  }
}

/**
 * SWC plugin equivalent (for Turbopack/newer Next.js versions)
 */
export function createClientLoggingSWCPlugin(options: BabelPluginOptions = {}) {
  // SWC plugin implementation would go here
  // For now, we'll focus on Babel which works with Next.js
  return {
    name: 'client-auto-logging-swc',
    // SWC visitor implementation
  };
}