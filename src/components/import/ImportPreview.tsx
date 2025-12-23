'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { publishImportedArticle } from '@/actions/importActions';
import { supabase_browser } from '@/lib/supabase';
import { type ImportSource } from '@/lib/schemas/schemas';

interface ImportPreviewProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBack: () => void;
    title: string;
    content: string;
    source: ImportSource;
}

type PreviewState = 'preview' | 'publishing' | 'success' | 'error';

const SOURCE_LABELS: Record<ImportSource, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    other: 'Other AI',
    generated: 'Generated',
};

export default function ImportPreview({
    open,
    onOpenChange,
    onBack,
    title,
    content,
    source,
}: ImportPreviewProps) {
    const router = useRouter();
    const [state, setState] = useState<PreviewState>('preview');
    const [error, setError] = useState<string | null>(null);

    const handlePublish = useCallback(async () => {
        setState('publishing');
        setError(null);

        try {
            // Get user ID
            const { data: userData, error: userError } = await supabase_browser.auth.getUser();
            if (userError || !userData?.user?.id) {
                throw new Error('Please log in to publish');
            }

            const result = await publishImportedArticle(title, content, source, userData.user.id);

            if (!result.success || !result.explanationId) {
                throw new Error(result.error?.message || 'Failed to publish article');
            }

            setState('success');

            // Navigate to the new article (keep modal open to avoid flash)
            setTimeout(() => {
                router.push(`/results?explanation_id=${result.explanationId}`);
            }, 1000);
        } catch (err) {
            setState('error');
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    }, [title, content, source, router, onOpenChange]);

    const handleClose = useCallback(() => {
        if (state !== 'publishing') {
            setState('preview');
            setError(null);
            onOpenChange(false);
        }
    }, [state, onOpenChange]);

    const handleBack = useCallback(() => {
        if (state !== 'publishing') {
            setState('preview');
            setError(null);
            onBack();
        }
    }, [state, onBack]);

    const isPublishing = state === 'publishing';

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] bg-[var(--surface-primary)] border-[var(--border-default)]">
                <DialogHeader>
                    <DialogTitle className="text-[var(--text-primary)] font-display text-xl">
                        Preview Import
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-muted)]">
                        Review the formatted article before publishing.
                        <span data-testid="preview-source" className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-[var(--surface-elevated)] text-[var(--text-secondary)]">
                            Source: {SOURCE_LABELS[source]}
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4 overflow-y-auto max-h-[60vh]">
                    {/* Title */}
                    <div className="space-y-1">
                        <label className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wider">
                            Title
                        </label>
                        <h2 data-testid="preview-title" className="text-xl font-display text-[var(--text-primary)]">
                            {title}
                        </h2>
                    </div>

                    {/* Content preview */}
                    <div className="space-y-1">
                        <label className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wider">
                            Content
                        </label>
                        <div data-testid="preview-content" className="p-4 rounded-page border border-[var(--border-default)] bg-[var(--surface-secondary)]">
                            <div className="prose prose-sm max-w-none text-[var(--text-primary)]">
                                {/* Simple markdown-like rendering */}
                                {content.split('\n').map((line, index) => {
                                    // Heading 2
                                    if (line.startsWith('## ')) {
                                        return (
                                            <h3 key={index} className="text-lg font-display font-semibold mt-4 mb-2 text-[var(--text-primary)]">
                                                {line.slice(3)}
                                            </h3>
                                        );
                                    }
                                    // Heading 3
                                    if (line.startsWith('### ')) {
                                        return (
                                            <h4 key={index} className="text-base font-display font-medium mt-3 mb-1 text-[var(--text-primary)]">
                                                {line.slice(4)}
                                            </h4>
                                        );
                                    }
                                    // List items
                                    if (line.startsWith('- ') || line.startsWith('* ')) {
                                        return (
                                            <li key={index} className="text-[var(--text-secondary)] ml-4">
                                                {line.slice(2)}
                                            </li>
                                        );
                                    }
                                    // Numbered list
                                    if (/^\d+\.\s/.test(line)) {
                                        return (
                                            <li key={index} className="text-[var(--text-secondary)] ml-4 list-decimal">
                                                {line.replace(/^\d+\.\s/, '')}
                                            </li>
                                        );
                                    }
                                    // Empty lines
                                    if (!line.trim()) {
                                        return <br key={index} />;
                                    }
                                    // Regular paragraph
                                    return (
                                        <p key={index} className="text-[var(--text-secondary)] mb-2">
                                            {line}
                                        </p>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Error message */}
                    {error && (
                        <div data-testid="preview-error" className="text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-4 py-2 rounded-page">
                            {error}
                        </div>
                    )}

                    {/* Success message */}
                    {state === 'success' && (
                        <div data-testid="preview-success" className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-4 py-3 rounded-page text-center">
                            <div className="font-medium">Article published successfully!</div>
                            <div className="text-green-500 mt-1">Taking you to your new explanation...</div>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        data-testid="back-btn"
                        variant="outline"
                        onClick={handleBack}
                        disabled={isPublishing}
                    >
                        Back
                    </Button>
                    <Button
                        data-testid="publish-btn"
                        onClick={handlePublish}
                        disabled={isPublishing || state === 'success'}
                    >
                        {isPublishing ? (
                            <>
                                <Spinner variant="circle" size={16} />
                                Publishing...
                            </>
                        ) : state === 'success' ? (
                            'Published!'
                        ) : (
                            'Publish'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
