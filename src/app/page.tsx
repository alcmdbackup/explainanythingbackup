'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
    const [prompt, setPrompt] = useState('');
    const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
    const router = useRouter();

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPrompt(e.target.value);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        setIsGeneratingExplanation(true);
        router.push(`/results?q=${encodeURIComponent(prompt)}`);
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
            <main className="container mx-auto px-4 max-w-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-6 tracking-tight">
                        Explain Anything
                    </h1>
                </div>
                <div className="flex flex-col items-center">
                    <div className="w-full">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm focus-within:ring-2 focus-within:ring-blue-600 focus-within:border-blue-600 dark:focus-within:ring-blue-500 dark:focus-within:border-blue-500 transition-all duration-200">
                                    <textarea
                                        id="prompt"
                                        value={prompt}
                                        onChange={handlePromptChange}
                                        className="flex-1 px-4 py-2.5 bg-transparent border-0 rounded-l-full focus:outline-none focus:ring-0 resize-none dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                                        rows={1}
                                        maxLength={150}
                                        placeholder="Learn about any topic"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isGeneratingExplanation || !prompt.trim()}
                                        className={`px-6 py-2.5 text-white rounded-r-full focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 bg-blue-600 hover:bg-blue-700`}
                                    >
                                        {isGeneratingExplanation ? 'Searching...' : 'Search Topic'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
