'use client';

import { useState, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { processImport, detectImportSource } from '@/actions/importActions';
import { supabase_browser } from '@/lib/supabase';
import { type ImportSource } from '@/lib/schemas/schemas';

interface ImportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onProcessed: (data: { title: string; content: string; source: ImportSource }) => void;
}

type ModalState = 'idle' | 'detecting' | 'processing' | 'error';

const SOURCE_LABELS: Record<ImportSource, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    other: 'Other AI',
    generated: 'Generated',
};

export default function ImportModal({ open, onOpenChange, onProcessed }: ImportModalProps) {
    const [content, setContent] = useState('');
    const [source, setSource] = useState<ImportSource>('other');
    const [state, setState] = useState<ModalState>('idle');
    const [error, setError] = useState<string | null>(null);

    const handleContentChange = useCallback(async (value: string) => {
        setContent(value);
        setError(null);

        // Auto-detect source when content is pasted (debounced)
        if (value.trim().length > 100) {
            setState('detecting');
            try {
                const result = await detectImportSource(value);
                if (!result.error) {
                    setSource(result.source);
                }
            } catch {
                // Ignore detection errors
            }
            setState('idle');
        }
    }, []);

    const handleProcess = useCallback(async () => {
        if (!content.trim()) {
            setError('Please paste some content to import');
            return;
        }

        setState('processing');
        setError(null);

        try {
            // Get user ID
            const { data: userData, error: userError } = await supabase_browser.auth.getUser();
            if (userError || !userData?.user?.id) {
                throw new Error('Please log in to import content');
            }

            const result = await processImport(content, userData.user.id, source);

            if (!result.success || !result.data) {
                throw new Error(result.error?.message || 'Failed to process content');
            }

            // Pass to preview
            onProcessed({
                title: result.data.title,
                content: result.data.content,
                source: result.data.detectedSource,
            });

            // Reset form
            setContent('');
            setSource('other');
            setState('idle');
        } catch (err) {
            setState('error');
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    }, [content, source, onProcessed]);

    const handleClose = useCallback(() => {
        if (state !== 'processing') {
            setContent('');
            setSource('other');
            setState('idle');
            setError(null);
            onOpenChange(false);
        }
    }, [state, onOpenChange]);

    const isProcessing = state === 'processing';

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl bg-[var(--surface-primary)] border-[var(--border-default)]">
                <DialogHeader>
                    <DialogTitle className="text-[var(--text-primary)] font-display text-xl">
                        Import from AI
                    </DialogTitle>
                    <DialogDescription className="text-[var(--text-muted)]">
                        Paste content from ChatGPT, Claude, or Gemini to import as an article.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Content textarea */}
                    <div className="space-y-2">
                        <label
                            htmlFor="import-content"
                            className="text-sm font-ui text-[var(--text-secondary)]"
                        >
                            Paste content
                        </label>
                        <textarea
                            id="import-content"
                            value={content}
                            onChange={(e) => handleContentChange(e.target.value)}
                            placeholder="Paste AI-generated content here..."
                            disabled={isProcessing}
                            className="w-full h-64 px-4 py-3 rounded-page border border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)] focus:border-transparent resize-none font-ui text-sm disabled:opacity-50"
                        />
                    </div>

                    {/* Source selector */}
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-ui text-[var(--text-secondary)] whitespace-nowrap">
                            Source:
                        </label>
                        <Select
                            value={source}
                            onValueChange={(value) => setSource(value as ImportSource)}
                            disabled={isProcessing}
                        >
                            <SelectTrigger className="w-40 bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-primary)]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[var(--surface-elevated)] border-[var(--border-default)]">
                                <SelectItem value="chatgpt" className="text-[var(--text-primary)]">
                                    {SOURCE_LABELS.chatgpt}
                                </SelectItem>
                                <SelectItem value="claude" className="text-[var(--text-primary)]">
                                    {SOURCE_LABELS.claude}
                                </SelectItem>
                                <SelectItem value="gemini" className="text-[var(--text-primary)]">
                                    {SOURCE_LABELS.gemini}
                                </SelectItem>
                                <SelectItem value="other" className="text-[var(--text-primary)]">
                                    {SOURCE_LABELS.other}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {state === 'detecting' && (
                            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                                <Spinner variant="circle" size={12} />
                                Detecting...
                            </span>
                        )}
                    </div>

                    {/* Error message */}
                    {error && (
                        <div className="text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-4 py-2 rounded-page">
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={isProcessing}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleProcess}
                        disabled={isProcessing || !content.trim()}
                    >
                        {isProcessing ? (
                            <>
                                <Spinner variant="circle" size={16} />
                                Processing...
                            </>
                        ) : (
                            'Process'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
