'use client';
/**
 * Admin dev tools index page.
 * Provides quick access to debug and test pages for development.
 */

import Link from 'next/link';

interface DevTool {
  name: string;
  description: string;
  href: string;
  category: 'editor' | 'rendering' | 'testing' | 'other';
}

const devTools: DevTool[] = [
  {
    name: 'Editor Test',
    description: 'Test the rich text editor component',
    href: '/editorTest',
    category: 'editor'
  },
  {
    name: 'Diff Test',
    description: 'Test content diffing functionality',
    href: '/diffTest',
    category: 'editor'
  },
  {
    name: 'AST Diff Demo',
    description: 'Markdown AST diffing demonstration',
    href: '/mdASTdiff_demo',
    category: 'editor'
  },
  {
    name: 'Results Test',
    description: 'Test the results page rendering',
    href: '/resultsTest',
    category: 'rendering'
  },
  {
    name: 'Streaming Test',
    description: 'Test streaming response handling',
    href: '/streaming-test',
    category: 'testing'
  },
  {
    name: 'LaTeX Test',
    description: 'Test LaTeX/math rendering',
    href: '/latex-test',
    category: 'rendering'
  },
  {
    name: 'Tailwind Test',
    description: 'Test Tailwind CSS styles',
    href: '/tailwind-test',
    category: 'rendering'
  },
  {
    name: 'Typography Test',
    description: 'Test typography and font rendering',
    href: '/typography-test',
    category: 'rendering'
  },
  {
    name: 'Client Logging Test',
    description: 'Test client-side logging',
    href: '/test-client-logging',
    category: 'testing'
  },
  {
    name: 'Global Error Test',
    description: 'Test global error boundary',
    href: '/test-global-error',
    category: 'testing'
  }
];

const categories = [
  { id: 'editor', label: 'Editor Tools', icon: '✏️' },
  { id: 'rendering', label: 'Rendering Tests', icon: '🎨' },
  { id: 'testing', label: 'Testing & Debugging', icon: '🔧' },
  { id: 'other', label: 'Other', icon: '📦' }
];

export default function DevToolsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dev Tools</h1>
        <p className="text-[var(--text-secondary)]">
          Debug and test pages for development purposes
        </p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-yellow-800 text-sm">
          <strong>Development Only:</strong> These tools are intended for development and debugging.
          They may expose internal implementation details.
        </p>
      </div>

      {categories.map((category) => {
        const categoryTools = devTools.filter(t => t.category === category.id);
        if (categoryTools.length === 0) return null;

        return (
          <div key={category.id} className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>{category.icon}</span>
              {category.label}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categoryTools.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  target="_blank"
                  className="block p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors"
                >
                  <h3 className="font-medium text-[var(--text-primary)]">{tool.name}</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{tool.description}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">{tool.href}</p>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {/* Quick Actions */}
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-4 mt-8">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Quick Links
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/audit"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            View Audit Logs
          </Link>
          <Link
            href="/admin/settings"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            Feature Flags
          </Link>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 text-sm bg-[var(--bg-tertiary)] rounded hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
          >
            Supabase Dashboard →
          </a>
        </div>
      </div>
    </div>
  );
}
