'use client';

import { useState, useEffect } from 'react';
import { supabase_browser } from '@/lib/supabase';
import { useClientPassRequestId } from '@/hooks/clientPassRequestId';

export default function StreamingTestPage() {
    const { withRequestId } = useClientPassRequestId('anonymous');
    const [prompt, setPrompt] = useState('');
    const [streamedText, setStreamedText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userid, setUserid] = useState<string | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);

    /**
     * Fetches the current user's ID from authentication
     */
    const fetchUserid = async (): Promise<string | null> => {
        const { data: userData, error: userError } = await supabase_browser.auth.getUser();
        if (userError) {
            setAuthError(`Authentication error: ${userError.message}`);
            setUserid(null);
            return null;
        }
        if (!userData?.user?.id) {
            setAuthError('No user data found - user may not be authenticated');
            setUserid(null);
            return null;
        }
        
        setUserid(userData.user.id);
        setAuthError(null);
        return userData.user.id;
    };

    // Fetch userid on component mount
    useEffect(() => {
        fetchUserid();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!prompt.trim()) {
            setError('Please enter a prompt');
            return;
        }

        if (!userid) {
            setError('User not authenticated. Please log in to use the streaming chat.');
            return;
        }

        setIsStreaming(true);
        setError(null);
        setStreamedText('');

        try {
            const response = await fetch('/api/stream-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(withRequestId({
                    prompt: prompt.trim(),
                    userid: userid
                })),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Failed to get response reader');
            }

            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            
                            if (data.error) {
                                setError(data.error);
                                setIsStreaming(false);
                                return;
                            }

                            if (data.text) {
                                setStreamedText(data.text);
                            }

                            if (data.isComplete) {
                                setIsStreaming(false);
                            }
                        } catch (parseError) {
                            console.error('Error parsing streaming data:', parseError);
                        }
                    }
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setIsStreaming(false);
        }
    };

    const clearAll = () => {
        setPrompt('');
        setStreamedText('');
        setError(null);
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1 className="text-3xl font-bold mb-6">Streaming Test Page</h1>
            
            {authError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {authError}
                </div>
            )}

            <form onSubmit={handleSubmit} className="mb-6">
                <div className="mb-4">
                    <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-2">
                        Enter your prompt:
                    </label>
                    <textarea
                        id="prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Ask something..."
                        className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={4}
                        disabled={isStreaming}
                    />
                </div>
                
                <div className="flex gap-3">
                    <button
                        type="submit"
                        disabled={isStreaming || !userid}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isStreaming ? 'Streaming...' : 'Submit'}
                    </button>
                    
                    <button
                        type="button"
                        onClick={clearAll}
                        disabled={isStreaming}
                        className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        Clear
                    </button>
                </div>
            </form>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {(streamedText || isStreaming) && (
                <div className="border border-gray-300 rounded-md p-4">
                    <h2 className="text-lg font-semibold mb-3">Streamed Response:</h2>
                    <div className="bg-gray-50 p-4 rounded border min-h-[200px] whitespace-pre-wrap text-black">
                        {streamedText || (isStreaming ? 'Waiting for response...' : '')}
                        {isStreaming && (
                            <span className="inline-block w-2 h-5 bg-gray-600 ml-1 animate-pulse">|</span>
                        )}
                    </div>
                    {isStreaming && (
                        <p className="text-sm text-gray-600 mt-2">Streaming in progress...</p>
                    )}
                </div>
            )}

            <div className="mt-8 p-4 bg-gray-100 rounded-md">
                <h3 className="font-semibold mb-2">Debug Info:</h3>
                <p><strong>User ID:</strong> {userid || 'Not logged in'}</p>
                <p><strong>Is Streaming:</strong> {isStreaming ? 'Yes' : 'No'}</p>
                <p><strong>Response Length:</strong> {streamedText.length} characters</p>
            </div>
        </div>
    );
}