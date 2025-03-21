'use client';

import { InlineMath, BlockMath } from 'react-katex';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function TestPage() {
    // Sample markdown text with LaTeX
    const markdownContent = `
Here's an inline equation: $E = mc^2$

And a block equation:

$$
\\sum_{i=1}^n i = \\frac{n(n+1)}{2}
$$
`;

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                        Math Test Page
                    </h1>
                    <div className="mt-6 text-2xl">
                        <InlineMath math="\frac{3}{4}" />
                    </div>
                </div>

                {/* New ReactMarkdown section */}
                <div className="mt-12 prose dark:prose-invert max-w-none">
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                        Markdown with LaTeX
                    </h2>
                    <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                            inlineMath: ({node, children}) => (
                                <InlineMath math={String(children).replace(/\$/g, '')} />
                            ),
                            math: ({node, children}) => (
                                <BlockMath math={String(children)} />
                            )
                        }}
                    >
                        {markdownContent}
                    </ReactMarkdown>
                </div>
            </main>
        </div>
    );
} 