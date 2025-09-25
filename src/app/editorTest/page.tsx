'use client';

import LexicalEditor, { LexicalEditorRef, EditModeToggle } from '../../editorFiles/lexicalEditor/LexicalEditor';
import { useState, useEffect, useRef } from 'react';
import { generateAISuggestionsAction, applyAISuggestionsAction, saveTestingPipelineStepAction, getTestingPipelineRecordsByStepAction, updateTestingPipelineRecordSetNameAction } from '../../editorFiles/actions/actions';
import { logger } from '../../lib/client_utilities';
import { RenderCriticMarkupFromMDAstDiff } from '../../editorFiles/markdownASTdiff/markdownASTdiff';
import { preprocessCriticMarkup } from '../../editorFiles/lexicalEditor/importExportUtils';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { 
    mergeAISuggestionOutput, 
    validateAISuggestionOutput,
    type AISuggestionOutput 
} from '../../editorFiles/aiSuggestion';

export default function EditorTestPage() {
    const [currentContent, setCurrentContent] = useState<string>('');
    const [aiSuggestions, setAiSuggestions] = useState<string>('');
    const [rawAIResponse, setRawAIResponse] = useState<string>('');
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);
    const [suggestionError, setSuggestionError] = useState<string>('');
    const [appliedEdits, setAppliedEdits] = useState<string>('');
    const [isApplyingEdits, setIsApplyingEdits] = useState<boolean>(false);
    const [applyError, setApplyError] = useState<string>('');
    const [isApplyingDiff, setIsApplyingDiff] = useState<boolean>(false);
    const [diffError, setDiffError] = useState<string>('');
    const [markdownASTDiffResult, setMarkdownASTDiffResult] = useState<string>('');
    const [isPreprocessing, setIsPreprocessing] = useState<boolean>(false);
    const [preprocessingError, setPreprocessingError] = useState<string>('');
    const [preprocessedMarkdown, setPreprocessedMarkdown] = useState<string>('');
    const [isMarkdownMode, setIsMarkdownMode] = useState<boolean>(true);
    const [testSetName, setTestSetName] = useState<string>('');

    // Dropdown state for loading previous results
    const [step1Options, setStep1Options] = useState<Array<{ id: number; name: string; content: string; created_at: string }>>([]);
    const [step2Options, setStep2Options] = useState<Array<{ id: number; name: string; content: string; created_at: string }>>([]);
    const [step3Options, setStep3Options] = useState<Array<{ id: number; name: string; content: string; created_at: string }>>([]);
    const [step4Options, setStep4Options] = useState<Array<{ id: number; name: string; content: string; created_at: string }>>([]);

    // Selected dropdown items for rename functionality
    const [selectedStep1Id, setSelectedStep1Id] = useState<number | null>(null);
    const [selectedStep2Id, setSelectedStep2Id] = useState<number | null>(null);
    const [selectedStep3Id, setSelectedStep3Id] = useState<number | null>(null);
    const [selectedStep4Id, setSelectedStep4Id] = useState<number | null>(null);

    // Validation state for preprocessed step
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const editorRef = useRef<LexicalEditorRef>(null);

    // Edit mode state management
    const [isEditMode, setIsEditMode] = useState<boolean>(true);

    const toggleEditMode = () => {
        setIsEditMode(!isEditMode);
    };

    // Default content about Albert Einstein
    const defaultContent = `# Albert Einstein: The Revolutionary Physicist

Albert Einstein was a German-born theoretical physicist who developed the theory of relativity, one of the two pillars of modern physics. Born on March 14, 1879, in Ulm, Germany, Einstein's revolutionary work fundamentally changed our understanding of space, time, and the universe itself.

## The Famous Equation

Einstein's most famous equation, **E = mc²**, demonstrates the equivalence of mass and energy, showing that a small amount of mass can be converted into a tremendous amount of energy. This insight laid the groundwork for nuclear power and fundamentally altered our understanding of the physical world.

## Legacy and Impact

Einstein's contributions to physics earned him the Nobel Prize in Physics in 1921, and his work continues to influence scientific research and technological development to this day.`;


    // Set initial content and test set name when component mounts
    useEffect(() => {
        setCurrentContent(defaultContent);
        // Generate a unique test set name based on timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        setTestSetName(`test-${timestamp}`);
        console.log('Initial content set:', defaultContent.length, 'characters');
    }, []);

    // Load dropdown options for each step
    const loadDropdownOptions = async () => {
        try {
            const [step1Result, step2Result, step3Result, step4Result] = await Promise.all([
                getTestingPipelineRecordsByStepAction('1_ai_suggestion'),
                getTestingPipelineRecordsByStepAction('2_edits_applied_to_markdown'),
                getTestingPipelineRecordsByStepAction('3_diff_applied_to_markdown'),
                getTestingPipelineRecordsByStepAction('4_preprocess_diff_before_import')
            ]);

            if (step1Result.success) setStep1Options(step1Result.data || []);
            if (step2Result.success) setStep2Options(step2Result.data || []);
            if (step3Result.success) setStep3Options(step3Result.data || []);
            if (step4Result.success) setStep4Options(step4Result.data || []);
        } catch (error) {
            console.error('Failed to load dropdown options:', error);
        }
    };

    // Load dropdown options when component mounts
    useEffect(() => {
        loadDropdownOptions();
    }, []);

    // Handle dropdown selection for each step
    const handleStep1Selection = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = parseInt(event.target.value);
        if (isNaN(selectedId)) {
            setSelectedStep1Id(null);
            return;
        }
        setSelectedStep1Id(selectedId);
        const selectedOption = step1Options.find(option => option.id === selectedId);
        if (selectedOption) {
            setAiSuggestions(selectedOption.content);
            console.log(`Loaded step 1 content from set: ${selectedOption.name}`);
        }
    };

    const handleStep2Selection = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = parseInt(event.target.value);
        if (isNaN(selectedId)) {
            setSelectedStep2Id(null);
            return;
        }
        setSelectedStep2Id(selectedId);
        const selectedOption = step2Options.find(option => option.id === selectedId);
        if (selectedOption) {
            setAppliedEdits(selectedOption.content);
            console.log(`Loaded step 2 content from set: ${selectedOption.name}`);
        }
    };

    const handleStep3Selection = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = parseInt(event.target.value);
        if (isNaN(selectedId)) {
            setSelectedStep3Id(null);
            return;
        }
        setSelectedStep3Id(selectedId);
        const selectedOption = step3Options.find(option => option.id === selectedId);
        if (selectedOption) {
            setMarkdownASTDiffResult(selectedOption.content);
            console.log(`Loaded step 3 content from set: ${selectedOption.name}`);
        }
    };

    const handleStep4Selection = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = parseInt(event.target.value);
        if (isNaN(selectedId)) {
            setSelectedStep4Id(null);
            setValidationErrors([]);
            return;
        }
        setSelectedStep4Id(selectedId);
        const selectedOption = step4Options.find(option => option.id === selectedId);
        if (selectedOption) {
            setPreprocessedMarkdown(selectedOption.content);

            // Validate the loaded content
            const errors = validatePreprocessedContent(selectedOption.content);
            setValidationErrors(errors);

            if (errors.length > 0) {
                console.log('⚠️ Validation errors found in loaded content:', errors);
            } else {
                console.log('✅ Loaded content passed validation');
            }

            console.log(`Loaded step 4 content from set: ${selectedOption.name}`);
        }
    };

    // Handle rename functionality for each step
    const handleRenameStep = async (stepNumber: number, recordId: number | null) => {
        if (!recordId) {
            alert('Please select an item from the dropdown first.');
            return;
        }

        const currentOption = (() => {
            switch (stepNumber) {
                case 1: return step1Options.find(option => option.id === recordId);
                case 2: return step2Options.find(option => option.id === recordId);
                case 3: return step3Options.find(option => option.id === recordId);
                case 4: return step4Options.find(option => option.id === recordId);
                default: return null;
            }
        })();

        if (!currentOption) {
            alert('Selected item not found.');
            return;
        }

        const newName = prompt(`Rename "${currentOption.name}" to:`, currentOption.name);
        if (!newName || newName === currentOption.name) {
            return;
        }

        try {
            const result = await updateTestingPipelineRecordSetNameAction(recordId, newName);
            if (result.success) {
                console.log(`✅ Renamed "${currentOption.name}" to "${newName}"`);
                // Refresh the dropdown options to show the updated name
                await loadDropdownOptions();
            } else {
                alert('Failed to rename: ' + (result.error?.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Failed to rename:', error);
            alert('Failed to rename the item.');
        }
    };

    // Validation function for preprocessed content
    const validatePreprocessedContent = (content: string): string[] => {
        const errors: string[] = [];
        const lines = content.split('\n');

        // First, identify all CriticMarkup blocks and their ranges
        const criticMarkupRanges: Array<{start: number, end: number, type: string}> = [];
        let currentBlock: {start: number, type: string, openTag: string} | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for opening CriticMarkup tags
            const openTags = [
                { pattern: /\{~~/, type: 'substitution', close: '~~}' },
                { pattern: /\{\+\+/, type: 'addition', close: '++}' },
                { pattern: /\{--/, type: 'deletion', close: '--}' },
                { pattern: /\{>>/, type: 'comment', close: '<<}' }
            ];

            for (const tag of openTags) {
                if (tag.pattern.test(line) && !currentBlock) {
                    currentBlock = { start: i, type: tag.type, openTag: tag.close };
                    break;
                }
            }

            // Check for closing tags
            if (currentBlock && line.includes(currentBlock.openTag)) {
                criticMarkupRanges.push({
                    start: currentBlock.start,
                    end: i,
                    type: currentBlock.type
                });
                currentBlock = null;
            }
        }

        // Helper function to check if a line is inside any CriticMarkup block
        const isLineInCriticMarkup = (lineIndex: number): boolean => {
            return criticMarkupRanges.some(range =>
                lineIndex >= range.start && lineIndex <= range.end
            );
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const previousLine = i > 0 ? lines[i - 1] : '';

            // Check A: All headings not enclosed in criticmarkup begin on a newline
            const headingMatch = line.match(/^(#+)\s/);
            if (headingMatch && !isLineInCriticMarkup(i)) {
                // This is a regular heading not in CriticMarkup, check if it starts on a newline
                if (i > 0 && previousLine.trim() !== '') {
                    errors.push(`Line ${i + 1}: Heading "${line.trim()}" should start on a newline (previous line: "${previousLine.trim()}")`);
                }
            }

            // Check B: Any criticmarkup containing headings starts on a newline
            // Check if this line starts a CriticMarkup block that contains headings
            const startsBlock = criticMarkupRanges.find(range => range.start === i);
            if (startsBlock) {
                // Check if this block contains any headings
                let blockContainsHeading = false;
                for (let j = startsBlock.start; j <= startsBlock.end; j++) {
                    if (lines[j].includes('#')) {
                        blockContainsHeading = true;
                        break;
                    }
                }

                if (blockContainsHeading && i > 0 && previousLine.trim() !== '') {
                    errors.push(`Line ${i + 1}: CriticMarkup containing heading should start on a newline (previous line: "${previousLine.trim()}")`);
                }
            }
        }

        return errors;
    };

    // Handle markdown mode toggle
    const handleMarkdownToggle = () => {
        if (editorRef.current) {
            // Toggle the internal state first
            const newMarkdownMode = !isMarkdownMode;
            setIsMarkdownMode(newMarkdownMode);
            // Use the new toggle method from LexicalEditor
            editorRef.current.toggleMarkdownMode();
        }
    };

    // Handle AI suggestions
    const handleGetAISuggestions = async () => {
        if (!currentContent) {
            setSuggestionError('No content available. Please type something in the editor first.');
            return;
        }

        setIsLoadingSuggestions(true);
        setSuggestionError('');
        setAiSuggestions('');

        try {
            // Use the existing action to get AI suggestions
            const result = await generateAISuggestionsAction(
                currentContent,
                'test-user'
            );

            if (result.success && result.data) {
                // Store the raw response for debugging
                setRawAIResponse(result.data);

                // Validate the response against the schema
                const validationResult = validateAISuggestionOutput(result.data);
                
                if (validationResult.success) {
                    // Merge the structured output into a readable format
                    const mergedOutput = mergeAISuggestionOutput(validationResult.data);
                    setAiSuggestions(mergedOutput);

                    // Step 1: Save merged AI suggestion to database
                    try {
                        const saveResult = await saveTestingPipelineStepAction(
                            testSetName,
                            '1_ai_suggestion',
                            mergedOutput
                        );

                        if (saveResult.success && saveResult.data?.saved) {
                            console.log('✅ Step 1: Merged AI suggestion saved to database');
                        } else {
                            console.log('ℹ️ Step 1: Merged AI suggestion already exists in database');
                        }
                    } catch (saveError) {
                        console.error('❌ Failed to save merged AI suggestion:', saveError);
                    }

                    logger.debug('AI suggestions received and validated', {
                        responseLength: result.data.length,
                        editsCount: validationResult.data.edits.length
                    });
                } else {
                    setSuggestionError(`AI response validation failed: ${validationResult.error.message}`);
                }
            } else {
                setSuggestionError(result.error?.message || 'Failed to generate AI suggestions');
            }
        } catch (error) {
            setSuggestionError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    // Handle applying AI suggestions
    const handleApplyAISuggestions = async () => {
        if (!aiSuggestions) {
            setApplyError('No AI suggestions available. Please generate suggestions first.');
            return;
        }

        if (!currentContent) {
            setApplyError('No original content available.');
            return;
        }

        setIsApplyingEdits(true);
        setApplyError('');
        setAppliedEdits('');

        try {
            // Use the existing action to apply AI suggestions
            const result = await applyAISuggestionsAction(
                aiSuggestions,
                currentContent,
                'test-user'
            );

            if (result.success && result.data) {
                setAppliedEdits(result.data);

                // Step 2: Save edits applied to database
                try {
                    const saveResult = await saveTestingPipelineStepAction(
                        testSetName,
                        '2_edits_applied_to_markdown',
                        result.data
                    );

                    if (saveResult.success && saveResult.data?.saved) {
                        console.log('✅ Step 2: Edits applied saved to database');
                    } else {
                        console.log('ℹ️ Step 2: Edits applied already exists in database');
                    }
                } catch (saveError) {
                    console.error('❌ Failed to save edits applied:', saveError);
                }

                logger.debug('AI suggestions applied successfully', {
                    responseLength: result.data.length
                });
            } else {
                setApplyError(result.error?.message || 'Failed to apply AI suggestions');
            }
        } catch (error) {
            setApplyError(error instanceof Error ? error.message : 'An unexpected error occurred');
        } finally {
            setIsApplyingEdits(false);
        }
    };

    // Handle applying 2-pass diff
    const handleApplyDiff = async () => {
        if (!currentContent) {
            setDiffError('No original content available.');
            return;
        }

        if (!appliedEdits) {
            setDiffError('No applied edits available. Please apply AI suggestions first.');
            return;
        }

        setIsApplyingDiff(true);
        setDiffError('');
        setMarkdownASTDiffResult('');

        try {
            // Use markdown AST diff
            const processor = unified().use(remarkParse);
            const beforeAST = processor.parse(currentContent) as any;
            const afterAST = processor.parse(appliedEdits) as any;
            
            const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
            setMarkdownASTDiffResult(criticMarkup);

            // Step 3: Save raw markdown to database
            try {
                const saveResult = await saveTestingPipelineStepAction(
                    testSetName,
                    '3_diff_applied_to_markdown',
                    criticMarkup
                );

                if (saveResult.success && saveResult.data?.saved) {
                    console.log('✅ Step 3: Raw markdown saved to database');
                } else {
                    console.log('ℹ️ Step 3: Raw markdown already exists in database');
                }
            } catch (saveError) {
                console.error('❌ Failed to save raw markdown:', saveError);
            }

            // Print the markdown with CriticMarkup to console
            console.log('📝 Diff Applied - Markdown with CriticMarkup (AST Diff):');
            console.log(criticMarkup);

            logger.debug('Markdown AST diff applied successfully', {
                beforeLength: currentContent.length,
                afterLength: appliedEdits.length,
                criticMarkupLength: criticMarkup.length
            });
        } catch (error) {
            setDiffError(error instanceof Error ? error.message : 'An unexpected error occurred while applying diff');
        } finally {
            setIsApplyingDiff(false);
        }
    };

    // Handle preprocessing CriticMarkup
    const handlePreprocessing = async () => {
        if (!markdownASTDiffResult) {
            setPreprocessingError('No markdown AST diff result available. Please apply diff first.');
            return;
        }

        setIsPreprocessing(true);
        setPreprocessingError('');
        setPreprocessedMarkdown('');
        setValidationErrors([]);

        try {
            const preprocessed = preprocessCriticMarkup(markdownASTDiffResult);
            setPreprocessedMarkdown(preprocessed);

            // Validate the preprocessed content
            const errors = validatePreprocessedContent(preprocessed);
            setValidationErrors(errors);

            // Step 4: Save preprocessed content to database
            try {
                const saveResult = await saveTestingPipelineStepAction(
                    testSetName,
                    '4_preprocess_diff_before_import',
                    preprocessed
                );

                if (saveResult.success && saveResult.data?.saved) {
                    console.log('✅ Step 4: Preprocessed content saved to database');
                } else {
                    console.log('ℹ️ Step 4: Preprocessed content already exists in database');
                }
            } catch (saveError) {
                console.error('❌ Failed to save preprocessed content:', saveError);
            }

            // Print validation results
            if (errors.length > 0) {
                console.log('⚠️ Validation errors found:', errors);
            } else {
                console.log('✅ Validation passed: All headings are properly formatted');
            }

            // Print the preprocessed markdown to console
            console.log('📝 Preprocessed Markdown:');
            console.log(preprocessed);

            logger.debug('CriticMarkup preprocessing completed successfully', {
                originalLength: markdownASTDiffResult.length,
                preprocessedLength: preprocessed.length,
                validationErrors: errors.length
            });
        } catch (error) {
            setPreprocessingError(error instanceof Error ? error.message : 'An unexpected error occurred while preprocessing');
        } finally {
            setIsPreprocessing(false);
        }
    };

    // Handle updating editor with preprocessed markdown
    const handleUpdateEditorWithMarkdown = () => {
        if (!preprocessedMarkdown) {
            return;
        }

        if (editorRef.current) {
            editorRef.current.setContentFromMarkdown(preprocessedMarkdown);
            logger.debug('Editor updated with preprocessed markdown', {
                markdownLength: preprocessedMarkdown.length
            });
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
                        Lexical Editor Test Page
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mb-4">
                        Test the Lexical rich text editor with the story of Albert Einstein
                    </p>
                    {testSetName && (
                        <p className="text-sm text-blue-600 dark:text-blue-400 mb-4">
                            Current test set: <code>{testSetName}</code>
                        </p>
                    )}
                    <div className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                        <p>Try typing in the editor below. You can use keyboard shortcuts like:</p>
                        <ul className="mt-2 space-y-1">
                            <li>• <strong>Ctrl+B</strong> or <strong>Cmd+B</strong> for bold text</li>
                            <li>• <strong>Ctrl+I</strong> or <strong>Cmd+I</strong> for italic text</li>
                            <li>• <strong>Ctrl+Z</strong> or <strong>Cmd+Z</strong> to undo</li>
                            <li>• <strong>Ctrl+Y</strong> or <strong>Cmd+Y</strong> to redo</li>
                        </ul>
                        {isMarkdownMode && (
                            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                                <p className="font-medium text-blue-900 dark:text-blue-100 mb-2">Markdown Mode Active</p>
                                <p className="text-blue-800 dark:text-blue-200 text-xs">
                                    You can use markdown syntax: <strong>**bold**</strong>, <em>*italic*</em>, <code>`code`</code>, 
                                    <code># heading</code>, <code>- list</code>, <code>{'>'} quote</code>
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Main Editor */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Rich Text Editor
                                </label>
                                <div className="flex items-center space-x-2">
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Raw Text</span>
                                    <button
                                        onClick={handleMarkdownToggle}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                            isMarkdownMode 
                                                ? 'bg-blue-600' 
                                                : 'bg-gray-200 dark:bg-gray-700'
                                        }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                isMarkdownMode ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Markdown</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex-1"></div>
                                <EditModeToggle isEditMode={isEditMode} onToggle={toggleEditMode} />
                            </div>
                            <LexicalEditor
                                ref={editorRef}
                                placeholder="Start writing your story about Albert Einstein or any other topic..."
                                className="w-full"
                                initialContent={defaultContent}
                                isMarkdownMode={isMarkdownMode}
                                isEditMode={isEditMode}
                                onContentChange={(content) => {
                                    console.log('Content changed:', content.length, 'characters');
                                    setCurrentContent(content);
                                }}
                            />
                        </div>
                    </div>

                    {/* AI Suggestions Panel */}
                    <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-100 mb-3">
                                AI Suggestions
                            </h3>
                            <div className="text-orange-800 dark:text-orange-200 text-sm space-y-4">
                                <p>
                                    Get AI-powered suggestions to improve your content. The AI will suggest edits with clear instructions.
                                </p>
                                
                                <div className="flex flex-wrap gap-2 items-end">
                                    <div className="flex-grow">
                                        <div className="text-xs text-orange-600 dark:text-orange-400 mb-2">
                                            Content length: {currentContent.length} characters |
                                            Button disabled: {isLoadingSuggestions ? 'Yes (loading)' : 'No'}
                                        </div>
                                        <button
                                            onClick={handleGetAISuggestions}
                                            disabled={isLoadingSuggestions}
                                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                isLoadingSuggestions
                                                    ? 'bg-orange-300 text-white cursor-not-allowed'
                                                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                                            }`}
                                        >
                                            {isLoadingSuggestions ? 'Processing...' : 'Get AI Suggestions'}
                                        </button>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-orange-600 dark:text-orange-400 mb-1">
                                            Load from database:
                                        </label>
                                        <div className="flex gap-1">
                                            <select
                                                onChange={handleStep1Selection}
                                                className="px-3 py-2 text-sm border border-orange-300 dark:border-orange-600 rounded-md bg-white dark:bg-gray-800 text-orange-900 dark:text-orange-100"
                                                defaultValue=""
                                            >
                                                <option value="">Select previous result...</option>
                                                {step1Options.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name} ({new Date(option.created_at).toLocaleDateString()})
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleRenameStep(1, selectedStep1Id)}
                                                disabled={!selectedStep1Id}
                                                className={`px-2 py-2 text-sm rounded-md transition-colors ${
                                                    selectedStep1Id
                                                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                }`}
                                                title="Rename selected item"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {suggestionError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {suggestionError}
                                        </p>
                                    </div>
                                )}

                                {rawAIResponse && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                                            Raw AI Response (JSON):
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-orange-300 dark:border-orange-600">
                                            <pre className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap font-mono">
                                                {rawAIResponse}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                {aiSuggestions && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                                            Formatted AI Suggestions:
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-orange-300 dark:border-orange-600">
                                            <pre className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap font-mono">
                                                {aiSuggestions}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Edits Applied Panel */}
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-3">
                                Edits Applied
                            </h3>
                            <div className="text-green-800 dark:text-green-200 text-sm space-y-4">
                                <p>
                                    Apply the AI suggestions to your content to see the improved version.
                                </p>

                                <div className="flex flex-wrap gap-2 items-end">
                                    <div className="flex-grow">
                                        <button
                                            onClick={handleApplyAISuggestions}
                                            disabled={!aiSuggestions || isApplyingEdits}
                                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                !aiSuggestions || isApplyingEdits
                                                    ? 'bg-gray-400 text-white cursor-not-allowed'
                                                    : 'bg-green-600 hover:bg-green-700 text-white'
                                            }`}
                                        >
                                            {isApplyingEdits ? 'Applying...' : 'Apply AI Suggestions'}
                                        </button>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-green-600 dark:text-green-400 mb-1">
                                            Load from database:
                                        </label>
                                        <div className="flex gap-1">
                                            <select
                                                onChange={handleStep2Selection}
                                                className="px-3 py-2 text-sm border border-green-300 dark:border-green-600 rounded-md bg-white dark:bg-gray-800 text-green-900 dark:text-green-100"
                                                defaultValue=""
                                            >
                                                <option value="">Select previous result...</option>
                                                {step2Options.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name} ({new Date(option.created_at).toLocaleDateString()})
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleRenameStep(2, selectedStep2Id)}
                                                disabled={!selectedStep2Id}
                                                className={`px-2 py-2 text-sm rounded-md transition-colors ${
                                                    selectedStep2Id
                                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                }`}
                                                title="Rename selected item"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {applyError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {applyError}
                                        </p>
                                    </div>
                                )}

                                {appliedEdits && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-green-900 dark:text-green-100 mb-2">
                                            Result:
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-green-300 dark:border-green-600">
                                            <pre className="text-sm text-green-900 dark:text-green-100 whitespace-pre-wrap font-mono">
                                                {appliedEdits}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Diff Applied Panel */}
                    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 mb-3">
                                Diff Applied
                            </h3>
                            <div className="text-purple-800 dark:text-purple-200 text-sm space-y-4">
                                <p>
                                    Apply a diff between the original content and the applied edits using markdown AST diff.
                                </p>
                                
                                
                                <div className="flex flex-wrap gap-2 items-end">
                                    <div className="flex-grow">
                                        <div className="text-xs text-purple-600 dark:text-purple-400 mb-2">
                                            Original content: {currentContent.length} characters |
                                            Applied edits: {appliedEdits.length} characters |
                                            Method: Markdown AST |
                                            Apply Diff disabled: {isApplyingDiff ? 'Yes (processing)' : 'No'}
                                        </div>
                                        <button
                                            onClick={handleApplyDiff}
                                            disabled={!currentContent || !appliedEdits || isApplyingDiff}
                                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                !currentContent || !appliedEdits || isApplyingDiff
                                                    ? 'bg-purple-300 text-white cursor-not-allowed'
                                                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                                            }`}
                                        >
                                            {isApplyingDiff ? 'Processing...' : 'Apply Diff'}
                                        </button>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-purple-600 dark:text-purple-400 mb-1">
                                            Load from database:
                                        </label>
                                        <div className="flex gap-1">
                                            <select
                                                onChange={handleStep3Selection}
                                                className="px-3 py-2 text-sm border border-purple-300 dark:border-purple-600 rounded-md bg-white dark:bg-gray-800 text-purple-900 dark:text-purple-100"
                                                defaultValue=""
                                            >
                                                <option value="">Select previous result...</option>
                                                {step3Options.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name} ({new Date(option.created_at).toLocaleDateString()})
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleRenameStep(3, selectedStep3Id)}
                                                disabled={!selectedStep3Id}
                                                className={`px-2 py-2 text-sm rounded-md transition-colors ${
                                                    selectedStep3Id
                                                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                }`}
                                                title="Rename selected item"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {diffError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {diffError}
                                        </p>
                                    </div>
                                )}

                                {markdownASTDiffResult && (
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <h4 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                                                Raw Markdown (CriticMarkup):
                                            </h4>
                                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-purple-300 dark:border-purple-600">
                                                <pre className="text-sm text-purple-900 dark:text-purple-100 whitespace-pre-wrap font-mono">
                                                    {markdownASTDiffResult}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Preprocessed Panel */}
                    <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-100 mb-3">
                                Preprocessed
                            </h3>
                            <div className="text-orange-800 dark:text-orange-200 text-sm space-y-4">
                                <p>
                                    Apply preprocessing to normalize multiline patterns and fix formatting issues.
                                </p>

                                <div className="flex flex-wrap gap-2 items-end">
                                    <div className="flex-grow">
                                        <button
                                            onClick={handlePreprocessing}
                                            disabled={!markdownASTDiffResult || isPreprocessing}
                                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                !markdownASTDiffResult || isPreprocessing
                                                    ? 'bg-gray-400 text-white cursor-not-allowed'
                                                    : 'bg-orange-600 hover:bg-orange-700 text-white'
                                            }`}
                                        >
                                            {isPreprocessing ? 'Preprocessing...' : 'Apply Preprocessing'}
                                        </button>
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-orange-600 dark:text-orange-400 mb-1">
                                            Load from database:
                                        </label>
                                        <div className="flex gap-1">
                                            <select
                                                onChange={handleStep4Selection}
                                                className="px-3 py-2 text-sm border border-orange-300 dark:border-orange-600 rounded-md bg-white dark:bg-gray-800 text-orange-900 dark:text-orange-100"
                                                defaultValue=""
                                            >
                                                <option value="">Select previous result...</option>
                                                {step4Options.map((option) => (
                                                    <option key={option.id} value={option.id}>
                                                        {option.name} ({new Date(option.created_at).toLocaleDateString()})
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleRenameStep(4, selectedStep4Id)}
                                                disabled={!selectedStep4Id}
                                                className={`px-2 py-2 text-sm rounded-md transition-colors ${
                                                    selectedStep4Id
                                                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                }`}
                                                title="Rename selected item"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {preprocessingError && (
                                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            Error: {preprocessingError}
                                        </p>
                                    </div>
                                )}

                                {validationErrors.length > 0 && (
                                    <div className="mt-4 p-4 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                                        <div className="flex items-start">
                                            <div className="flex-shrink-0">
                                                <span className="text-red-600 dark:text-red-400 text-lg">⚠️</span>
                                            </div>
                                            <div className="ml-3">
                                                <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                                                    Heading Validation Errors
                                                </h4>
                                                <div className="text-red-700 dark:text-red-300 text-sm">
                                                    <p className="mb-2">The following heading formatting issues were found:</p>
                                                    <ul className="list-disc list-inside space-y-1">
                                                        {validationErrors.map((error, index) => (
                                                            <li key={index}>{error}</li>
                                                        ))}
                                                    </ul>
                                                    <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                                                        <strong>Requirements:</strong> All headings (not in CriticMarkup) and CriticMarkup containing headings must start on a new line.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {preprocessedMarkdown && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-2">
                                            Result:
                                        </h4>
                                        <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-orange-300 dark:border-orange-600">
                                            <pre className="text-sm text-orange-900 dark:text-orange-100 whitespace-pre-wrap font-mono">
                                                {preprocessedMarkdown}
                                            </pre>
                                        </div>

                                        <div className="mt-4">
                                            <button
                                                onClick={handleUpdateEditorWithMarkdown}
                                                disabled={!preprocessedMarkdown}
                                                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                                    !preprocessedMarkdown
                                                        ? 'bg-gray-400 text-white cursor-not-allowed'
                                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                                }`}
                                            >
                                                Update Editor Window with Markdown
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Instructions Panel */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="p-6">
                            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
                                About This Editor
                            </h3>
                            <div className="text-blue-800 dark:text-blue-200 text-sm space-y-2">
                                <p>
                                    This is a <strong>Lexical</strong> rich text editor - a modern, extensible text editor framework 
                                    developed by Meta (Facebook). It provides a robust foundation for building rich text editing experiences.
                                </p>
                                <p>
                                    The editor supports rich text formatting, undo/redo functionality, and is designed to be 
                                    highly customizable and performant. It now includes AI suggestions powered by GPT-4o-mini.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
