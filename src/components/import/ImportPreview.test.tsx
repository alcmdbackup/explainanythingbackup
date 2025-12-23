/**
 * Unit tests for ImportPreview component
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportPreview from './ImportPreview';

// Mock server actions
jest.mock('@/actions/importActions', () => ({
    publishImportedArticle: jest.fn(),
}));

// Mock Supabase client
jest.mock('@/lib/supabase', () => ({
    supabase_browser: {
        auth: {
            getUser: jest.fn(),
        },
    },
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({
        push: jest.fn(),
    })),
}));

import { publishImportedArticle } from '@/actions/importActions';
import { supabase_browser } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

describe('ImportPreview', () => {
    const mockPush = jest.fn();
    const defaultProps = {
        open: true,
        onOpenChange: jest.fn(),
        onBack: jest.fn(),
        title: 'Understanding React Hooks',
        content: '## Introduction\n\nReact Hooks are a powerful feature.\n\n### useState\n\nThe useState hook lets you add state.\n\n- First point\n- Second point\n\n1. Step one\n2. Step two',
        source: 'chatgpt' as const,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        // Default: user is authenticated
        (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
            data: { user: { id: 'test-user-123' } },
            error: null,
        });
        // Default: publish succeeds
        (publishImportedArticle as jest.Mock).mockResolvedValue({
            success: true,
            explanationId: 456,
            error: null,
        });
        // Mock router
        (useRouter as jest.Mock).mockReturnValue({
            push: mockPush,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // ========================================================================
    // Rendering Tests
    // ========================================================================

    describe('Rendering', () => {
        it('renders dialog when open=true', () => {
            render(<ImportPreview {...defaultProps} open={true} />);
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText('Preview Import')).toBeInTheDocument();
        });

        it('does not render dialog when open=false', () => {
            render(<ImportPreview {...defaultProps} open={false} />);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('displays title prop', () => {
            render(<ImportPreview {...defaultProps} />);
            expect(screen.getByText('Understanding React Hooks')).toBeInTheDocument();
        });

        it('displays source badge', () => {
            render(<ImportPreview {...defaultProps} />);
            expect(screen.getByText(/source: chatgpt/i)).toBeInTheDocument();
        });

        it('shows Back and Publish buttons', () => {
            render(<ImportPreview {...defaultProps} />);
            expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
        });
    });

    // ========================================================================
    // Content Rendering Tests (markdown-like)
    // ========================================================================

    describe('Content Rendering', () => {
        it('renders ## lines as h3 headings', () => {
            render(<ImportPreview {...defaultProps} />);
            const heading = screen.getByText('Introduction');
            expect(heading.tagName).toBe('H3');
        });

        it('renders ### lines as h4 headings', () => {
            render(<ImportPreview {...defaultProps} />);
            const heading = screen.getByText('useState');
            expect(heading.tagName).toBe('H4');
        });

        it('renders - lines as list items', () => {
            render(<ImportPreview {...defaultProps} />);
            expect(screen.getByText('First point')).toBeInTheDocument();
            expect(screen.getByText('Second point')).toBeInTheDocument();
        });

        it('renders numbered lines as list items', () => {
            render(<ImportPreview {...defaultProps} />);
            expect(screen.getByText('Step one')).toBeInTheDocument();
            expect(screen.getByText('Step two')).toBeInTheDocument();
        });

        it('renders regular lines as paragraphs', () => {
            render(<ImportPreview {...defaultProps} />);
            const paragraph = screen.getByText('React Hooks are a powerful feature.');
            expect(paragraph.tagName).toBe('P');
        });
    });

    // ========================================================================
    // Publish Flow Tests
    // ========================================================================

    describe('Publish Flow', () => {
        it('shows "Please log in to publish" error when not authenticated', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
                data: { user: null },
                error: { message: 'Not authenticated' },
            });

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(screen.getByText(/please log in/i)).toBeInTheDocument();
            });
        });

        it('calls publishImportedArticle with correct arguments when authenticated', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(publishImportedArticle).toHaveBeenCalledWith(
                    'Understanding React Hooks',
                    defaultProps.content,
                    'chatgpt',
                    'test-user-123'
                );
            });
        });

        it('shows spinner with "Publishing..." text during publishing', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            // Make publishing take some time
            (publishImportedArticle as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ success: true, explanationId: 123, error: null }), 200)
                    )
            );

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            expect(screen.getByText('Publishing...')).toBeInTheDocument();
        });

        it('disables Back and Publish buttons during publishing', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            (publishImportedArticle as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ success: true, explanationId: 123, error: null }), 200)
                    )
            );

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /publishing/i })).toBeDisabled();
        });

        it('shows "Article published successfully!" on success', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(screen.getByText(/article published successfully/i)).toBeInTheDocument();
            });
        });

        it('changes button to "Published!" on success', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /published!/i })).toBeInTheDocument();
            });
        });

        it('navigates to results page after 500ms delay on success', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            const mockOnOpenChange = jest.fn();
            render(<ImportPreview {...defaultProps} onOpenChange={mockOnOpenChange} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            // Wait for success state
            await waitFor(() => {
                expect(screen.getByText(/article published successfully/i)).toBeInTheDocument();
            });

            // Advance timers by 500ms
            jest.advanceTimersByTime(500);

            await waitFor(() => {
                expect(mockOnOpenChange).toHaveBeenCalledWith(false);
                expect(mockPush).toHaveBeenCalledWith('/results?explanation_id=456');
            });
        });
    });

    // ========================================================================
    // Error Handling Tests
    // ========================================================================

    describe('Error Handling', () => {
        it('shows error message from publishImportedArticle', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            (publishImportedArticle as jest.Mock).mockResolvedValue({
                success: false,
                explanationId: null,
                error: { message: 'Database error' },
            });

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(screen.getByText(/database error/i)).toBeInTheDocument();
            });
        });

        it('shows generic error when publish returns no explanationId', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            (publishImportedArticle as jest.Mock).mockResolvedValue({
                success: true,
                explanationId: null,
                error: null,
            });

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            await waitFor(() => {
                expect(screen.getByText(/failed to publish/i)).toBeInTheDocument();
            });
        });
    });

    // ========================================================================
    // Modal Behavior Tests
    // ========================================================================

    describe('Modal Behavior', () => {
        it('Back button calls onBack when not publishing', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            const mockOnBack = jest.fn();
            render(<ImportPreview {...defaultProps} onBack={mockOnBack} />);
            const backBtn = screen.getByRole('button', { name: /back/i });

            await user.click(backBtn);

            expect(mockOnBack).toHaveBeenCalled();
        });

        it('Back button is disabled during publishing', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            (publishImportedArticle as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ success: true, explanationId: 123, error: null }), 200)
                    )
            );

            render(<ImportPreview {...defaultProps} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            const backBtn = screen.getByRole('button', { name: /back/i });
            expect(backBtn).toBeDisabled();
        });

        it('cannot close during publishing (Back button click ignored)', async () => {
            const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
            const mockOnBack = jest.fn();
            (publishImportedArticle as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(() => resolve({ success: true, explanationId: 123, error: null }), 200)
                    )
            );

            render(<ImportPreview {...defaultProps} onBack={mockOnBack} />);
            const publishBtn = screen.getByRole('button', { name: /publish/i });

            await user.click(publishBtn);

            // Try to click Back during publishing
            const backBtn = screen.getByRole('button', { name: /back/i });
            await user.click(backBtn);

            // Should not have called onBack
            expect(mockOnBack).not.toHaveBeenCalled();
        });

        it('displays different source labels correctly', () => {
            const { rerender } = render(<ImportPreview {...defaultProps} source="claude" />);
            expect(screen.getByText(/source: claude/i)).toBeInTheDocument();

            rerender(<ImportPreview {...defaultProps} source="gemini" />);
            expect(screen.getByText(/source: gemini/i)).toBeInTheDocument();

            rerender(<ImportPreview {...defaultProps} source="other" />);
            expect(screen.getByText(/source: other ai/i)).toBeInTheDocument();
        });
    });
});
