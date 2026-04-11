/**
 * Unit tests for ImportModal component
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportModal from './ImportModal';

// Mock server actions
jest.mock('@/actions/importActions', () => ({
    processImport: jest.fn(),
}));

// Mock detectSource (now called client-side directly)
jest.mock('@/lib/services/importArticle', () => ({
    detectSource: jest.fn(),
}));

// Mock Supabase client
jest.mock('@/lib/supabase', () => ({
    supabase_browser: {
        auth: {
            getUser: jest.fn(),
        },
    },
}));

import { processImport } from '@/actions/importActions';
import { detectSource } from '@/lib/services/importArticle';
import { supabase_browser } from '@/lib/supabase';

describe('ImportModal', () => {
    const defaultProps = {
        open: true,
        onOpenChange: jest.fn(),
        onProcessed: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Default: user is authenticated
        (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
            data: { user: { id: 'test-user-123' } },
            error: null,
        });
        // Default: source detection returns 'other'
        (detectSource as jest.Mock).mockReturnValue('other');
    });

    // ========================================================================
    // Rendering Tests
    // ========================================================================

    describe('Rendering', () => {
        it('renders dialog when open=true', () => {
            render(<ImportModal {...defaultProps} open={true} />);
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText('Import from AI')).toBeInTheDocument();
        });

        it('does not render dialog when open=false', () => {
            render(<ImportModal {...defaultProps} open={false} />);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        it('shows textarea with correct placeholder', () => {
            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            expect(textarea).toBeInTheDocument();
            expect(textarea).toHaveAttribute('placeholder', 'Paste AI-generated content here...');
        });

        it('shows Cancel and Process buttons', () => {
            render(<ImportModal {...defaultProps} />);
            expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /process/i })).toBeInTheDocument();
        });

        it('Process button is disabled when content is empty', () => {
            render(<ImportModal {...defaultProps} />);
            const processBtn = screen.getByRole('button', { name: /process/i });
            expect(processBtn).toBeDisabled();
        });
    });

    // ========================================================================
    // Content Input Tests
    // ========================================================================

    describe('Content Input', () => {
        it('updates textarea value on change', async () => {
            const user = userEvent.setup();
            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');

            await user.type(textarea, 'Test content');
            expect(textarea).toHaveValue('Test content');
        });

        it('enables Process button when content is entered', async () => {
            const user = userEvent.setup();
            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            expect(processBtn).toBeDisabled();
            await user.type(textarea, 'Test content');
            expect(processBtn).not.toBeDisabled();
        });

        it('calls detectSource when content exceeds 100 chars', () => {
            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByTestId('import-content');

            const longContent = 'a'.repeat(105);
            fireEvent.change(textarea, { target: { value: longContent } });

            expect(detectSource).toHaveBeenCalledWith(longContent);
        });

        it('does not call detectSource for content under 100 chars', () => {
            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByTestId('import-content');

            fireEvent.change(textarea, { target: { value: 'Short content' } });

            expect(detectSource).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Source Selection Tests
    // ========================================================================

    describe('Source Selection', () => {
        it('default source is "other"', () => {
            render(<ImportModal {...defaultProps} />);
            // Find the select trigger and verify it shows "Other AI"
            expect(screen.getByRole('combobox')).toHaveTextContent('Other AI');
        });

        it('updates source dropdown based on detectSource result', () => {
            (detectSource as jest.Mock).mockReturnValue('chatgpt');

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');

            const longContent = 'a'.repeat(105);
            fireEvent.change(textarea, { target: { value: longContent } });

            expect(screen.getByRole('combobox')).toHaveTextContent('ChatGPT');
        });
    });

    // ========================================================================
    // Processing Flow Tests
    // ========================================================================

    describe('Processing Flow', () => {
        it('shows "Please log in..." error when not authenticated', async () => {
            const user = userEvent.setup();
            (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
                data: { user: null },
                error: { message: 'Not authenticated' },
            });

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            await waitFor(() => {
                expect(screen.getByText(/please log in/i)).toBeInTheDocument();
            });
        });

        it('calls processImport with correct arguments when authenticated', async () => {
            const user = userEvent.setup();
            (processImport as jest.Mock).mockResolvedValue({
                success: true,
                data: { title: 'Test', content: 'Test content', detectedSource: 'other' },
                error: null,
            });

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            await waitFor(() => {
                expect(processImport).toHaveBeenCalledWith('Test content', 'test-user-123', 'other');
            });
        });

        it('shows spinner with "Processing..." text during processing', async () => {
            const user = userEvent.setup();
            // Make processing take some time
            (processImport as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    success: true,
                                    data: { title: 'Test', content: 'Test', detectedSource: 'other' },
                                }),
                            100
                        )
                    )
            );

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            expect(screen.getByText('Processing...')).toBeInTheDocument();
        });

        it('disables Cancel and Process buttons during processing', async () => {
            const user = userEvent.setup();
            (processImport as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    success: true,
                                    data: { title: 'Test', content: 'Test', detectedSource: 'other' },
                                }),
                            100
                        )
                    )
            );

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');

            await user.type(textarea, 'Test content');
            await user.click(screen.getByRole('button', { name: /process/i }));

            expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
        });

        it('calls onProcessed callback with data on success', async () => {
            const user = userEvent.setup();
            const mockOnProcessed = jest.fn();
            (processImport as jest.Mock).mockResolvedValue({
                success: true,
                data: {
                    title: 'Understanding React',
                    content: '## Intro\n\nReact is great.',
                    detectedSource: 'chatgpt',
                },
                error: null,
            });

            render(<ImportModal {...defaultProps} onProcessed={mockOnProcessed} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            await waitFor(() => {
                expect(mockOnProcessed).toHaveBeenCalledWith({
                    title: 'Understanding React',
                    content: '## Intro\n\nReact is great.',
                    source: 'chatgpt',
                });
            });
        });

        it('shows error message on failure', async () => {
            const user = userEvent.setup();
            (processImport as jest.Mock).mockResolvedValue({
                success: false,
                data: null,
                error: { message: 'Content too short' },
            });

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            await waitFor(() => {
                expect(screen.getByText(/content too short/i)).toBeInTheDocument();
            });
        });

        it('resets form state after successful processing', async () => {
            const user = userEvent.setup();
            (processImport as jest.Mock).mockResolvedValue({
                success: true,
                data: { title: 'Test', content: 'Test', detectedSource: 'chatgpt' },
                error: null,
            });

            render(<ImportModal {...defaultProps} />);
            const textarea = screen.getByRole('textbox');
            const processBtn = screen.getByRole('button', { name: /process/i });

            await user.type(textarea, 'Test content');
            await user.click(processBtn);

            await waitFor(() => {
                expect(textarea).toHaveValue('');
            });
        });
    });

    // ========================================================================
    // Modal Behavior Tests
    // ========================================================================

    describe('Modal Behavior', () => {
        it('clicking Cancel calls onOpenChange(false)', async () => {
            const user = userEvent.setup();
            const mockOnOpenChange = jest.fn();

            render(<ImportModal {...defaultProps} onOpenChange={mockOnOpenChange} />);
            const cancelBtn = screen.getByRole('button', { name: /cancel/i });

            await user.click(cancelBtn);

            expect(mockOnOpenChange).toHaveBeenCalledWith(false);
        });

        it('cannot close during processing', async () => {
            const user = userEvent.setup();
            const mockOnOpenChange = jest.fn();
            (processImport as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve({
                                    success: true,
                                    data: { title: 'Test', content: 'Test', detectedSource: 'other' },
                                }),
                            200
                        )
                    )
            );

            render(<ImportModal {...defaultProps} onOpenChange={mockOnOpenChange} />);
            const textarea = screen.getByRole('textbox');

            await user.type(textarea, 'Test content');
            await user.click(screen.getByRole('button', { name: /process/i }));

            // Try to click Cancel during processing
            const cancelBtn = screen.getByRole('button', { name: /cancel/i });
            await user.click(cancelBtn);

            // Should not have called onOpenChange
            expect(mockOnOpenChange).not.toHaveBeenCalled();
        });

        it('shows error when trying to process empty content', async () => {
            const user = userEvent.setup();
            render(<ImportModal {...defaultProps} />);

            // The Process button should be disabled when empty
            const processBtn = screen.getByRole('button', { name: /process/i });
            expect(processBtn).toBeDisabled();
        });
    });
});
