'use client';

import { useState, useRef, useEffect } from 'react';
import LexicalEditor, { LexicalEditorRef } from '../../editorFiles/LexicalEditor';
import { debugTextNodeStructure, debugCriticMarkupMatching, preprocessCriticMarkup } from '../../editorFiles/diffUtils';

export default function DebugCriticPage() {
  const [testContent, setTestContent] = useState('');
  const editorRef = useRef<LexicalEditorRef>(null);

  // Test content with CriticMarkup - using single line first
  const singleLineTest = `{--# Albert Einstein: The Revolutionary Physicist--}{++# Albert Einstein: The Visionary Theoretical Physicist++}`;
  
  // Test content with newlines
  const multiLineTest = `{--# Albert Einstein: The Revolutionary Physicist
--}{++# Albert Einstein: The Visionary Theoretical Physicist
++}`;

  const handleLoadSingleLine = () => {
    if (editorRef.current) {
      console.log('🔄 Loading single-line test content...');
      console.log('📝 Content:', JSON.stringify(singleLineTest));
      editorRef.current.setContentFromMarkdown(singleLineTest);
      
      // Debug after a short delay to let the editor update
      setTimeout(() => {
        if (editorRef.current) {
          const editor = (editorRef.current as any).editor;
          if (editor) {
            debugTextNodeStructure(editor);
          }
        }
      }, 100);
    }
  };

  const handleLoadMultiLine = () => {
    if (editorRef.current) {
      console.log('🔄 Loading multi-line test content...');
      console.log('📝 Content:', JSON.stringify(multiLineTest));
      editorRef.current.setContentFromMarkdown(multiLineTest);
      
      // Debug after a short delay to let the editor update
      setTimeout(() => {
        if (editorRef.current) {
          const editor = (editorRef.current as any).editor;
          if (editor) {
            debugTextNodeStructure(editor);
          }
        }
      }, 100);
    }
  };

  const handleDebugRegex = () => {
    console.log('🔍 Testing regex on single-line content:');
    debugCriticMarkupMatching(singleLineTest);
    
    console.log('🔍 Testing regex on multi-line content:');
    debugCriticMarkupMatching(multiLineTest);
    
    console.log('🔍 Testing preprocessing function:');
    const processed = preprocessCriticMarkup(multiLineTest);
    console.log('Original multi-line:', JSON.stringify(multiLineTest));
    console.log('Processed multi-line:', JSON.stringify(processed));
    console.log('🔍 Testing regex on processed multi-line content:');
    debugCriticMarkupMatching(processed);
  };

  const handleGetContent = () => {
    if (editorRef.current) {
      const content = editorRef.current.getContentAsMarkdown();
      console.log('📤 Editor content as markdown:', JSON.stringify(content));
      setTestContent(content);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            CriticMarkup Debug Page
          </h1>
          
          <div className="space-y-4">
            <div className="flex gap-4 flex-wrap">
              <button
                onClick={handleLoadSingleLine}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Load Single-Line Test
              </button>
              <button
                onClick={handleLoadMultiLine}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Load Multi-Line Test
              </button>
              <button
                onClick={handleDebugRegex}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
              >
                Debug Regex
              </button>
              <button
                onClick={handleGetContent}
                className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"
              >
                Get Editor Content
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Lexical Editor */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  Lexical Editor
                </h2>
                <div className="border border-gray-300 dark:border-gray-600 rounded-md">
                  <LexicalEditor
                    ref={editorRef}
                    placeholder="Enter text with CriticMarkup..."
                    className="min-h-[300px]"
                    initialContent=""
                    isMarkdownMode={true}
                  />
                </div>
              </div>

              {/* Test Content Display */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  Test Content
                </h2>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Single-Line:</h3>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-md p-3">
                      <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                        {JSON.stringify(singleLineTest)}
                      </pre>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Multi-Line:</h3>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-md p-3">
                      <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                        {JSON.stringify(multiLineTest)}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Current Content Display */}
            {testContent && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  Current Editor Content
                </h2>
                <div className="bg-gray-100 dark:bg-gray-800 rounded-md p-4">
                  <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {JSON.stringify(testContent)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
