import { diffLines, diffWords } from 'diff';

/**
 * Creates a unified diff structure combining line and word-level changes
 * 
 * This function takes the original text and modified text, performs line-level diff first,
 * then consolidates paired line changes into word-level diffs, creating a single unified structure.
 * 
 * @param originalText - The original text content
 * @param modifiedText - The modified text content
 * @returns Unified diff structure with consolidated line and word changes
 */
export function createUnifiedDiff(originalText: string, modifiedText: string) {
    // First pass: Line-level diff
    const lineDiff = diffLines(originalText, modifiedText, {
        newlineIsToken: true
    });

    // Transform to detailed structure
    const detailedDiff = lineDiff.map((part: any) => ({
        ...part,
        type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
        wordLevelChanges: null
    }));

    // Create unified diff structure
    const unifiedDiff = [];
    const wordLevelAnalysis = [];
    
    for (let i = 0; i < detailedDiff.length; i++) {
        const currentPart = detailedDiff[i];
        const nextPart = detailedDiff[i + 1];
        
        if (currentPart.type === 'removed' && nextPart && nextPart.type === 'added') {
            // Paired removed/added lines - replace with individual word-level diffs
            const wordDiff = diffWords(currentPart.value, nextPart.value);
            
            // Add each word change as a separate segment
            wordDiff.forEach((wordPart: any) => {
                if (wordPart.added) {
                    unifiedDiff.push({
                        type: 'word-added',
                        content: wordPart.value,
                        lineCount: 1
                    });
                } else if (wordPart.removed) {
                    unifiedDiff.push({
                        type: 'word-removed',
                        content: wordPart.value,
                        lineCount: 1
                    });
                } else {
                    unifiedDiff.push({
                        type: 'word-unchanged',
                        content: wordPart.value,
                        lineCount: 1
                    });
                }
            });
            
            wordLevelAnalysis.push({
                original: currentPart.value,
                modified: nextPart.value,
                wordDiff: wordDiff
            });
            
            // Skip the next part since we've processed it
            i++;
            
        } else if (currentPart.type === 'added') {
            // Unpaired added line
            unifiedDiff.push({
                type: 'line-added',
                content: currentPart.value,
                lineCount: currentPart.count
            });
            
        } else if (currentPart.type === 'removed') {
            // Unpaired removed line
            unifiedDiff.push({
                type: 'line-removed',
                content: currentPart.value,
                lineCount: currentPart.count
            });
            
        } else {
            // Unchanged line
            unifiedDiff.push({
                type: 'line-unchanged',
                content: currentPart.value,
                lineCount: currentPart.count
            });
        }
    }

    return {
        unifiedDiff,
        wordLevelAnalysis,
        summary: {
            totalSegments: unifiedDiff.length,
            wordAddedSegments: unifiedDiff.filter(seg => seg.type === 'word-added').length,
            wordRemovedSegments: unifiedDiff.filter(seg => seg.type === 'word-removed').length,
            wordUnchangedSegments: unifiedDiff.filter(seg => seg.type === 'word-unchanged').length,
            lineAddedSegments: unifiedDiff.filter(seg => seg.type === 'line-added').length,
            lineRemovedSegments: unifiedDiff.filter(seg => seg.type === 'line-removed').length,
            unchangedSegments: unifiedDiff.filter(seg => seg.type === 'line-unchanged').length,
            wordLevelComparisons: wordLevelAnalysis.length
        }
    };
}

/**
 * Formats the diff result for display
 * 
 * This function takes the unified diff result and formats it into a readable string
 * with proper highlighting and formatting for display in the UI.
 * 
 * @param diffResult - The result from createUnifiedDiff
 * @returns Formatted string representation of the diff
 */
export function formatDiffForDisplay(diffResult: ReturnType<typeof createUnifiedDiff>) {
    let formattedOutput = '';
    
    // Show word-level changes
    const wordChanges = diffResult.unifiedDiff.filter(seg => 
        seg.type === 'word-added' || seg.type === 'word-removed'
    );
    
    if (wordChanges.length > 0) {
        formattedOutput += '=== WORD-LEVEL CHANGES ===\n';
        wordChanges.forEach((seg, index) => {
            if (seg.type === 'word-added') {
                formattedOutput += `[+${seg.content}]`;
            } else if (seg.type === 'word-removed') {
                formattedOutput += `[-${seg.content}]`;
            }
        });
        formattedOutput += '\n';
    }
    
    // Show unpaired line additions/removals
    const unpairedChanges = diffResult.unifiedDiff.filter(seg => 
        seg.type === 'line-added' || seg.type === 'line-removed'
    );
    
    if (unpairedChanges.length > 0) {
        formattedOutput += '\n=== UNPAIRED CHANGES ===\n';
        unpairedChanges.forEach(seg => {
            if (seg.type === 'line-added') {
                formattedOutput += `\n[ADDED] ${seg.content}`;
            } else if (seg.type === 'line-removed') {
                formattedOutput += `\n[REMOVED] ${seg.content}`;
            }
        });
    }
    
    return formattedOutput.trim();
}

/**
 * Creates a visual diff representation with HTML-like formatting
 * 
 * This function creates a more visual representation of the unified diff
 * that can be styled with CSS classes for better presentation.
 * 
 * @param diffResult - The result from createUnifiedDiff
 * @returns Array of formatted diff segments with styling information
 */
export interface VisualDiffSegment {
    content: string;
    type: 'added' | 'removed' | 'unchanged';
    className: 'diff-added' | 'diff-removed' | 'diff-unchanged' | 'diff-header' | 'diff-subheader';
}

export function createVisualDiff(diffResult: ReturnType<typeof createUnifiedDiff>): VisualDiffSegment[] {
    const segments: VisualDiffSegment[] = [];
    
    // Show word-level changes
    const wordChanges = diffResult.unifiedDiff.filter(seg => 
        seg.type === 'word-added' || seg.type === 'word-removed'
    );
    
    if (wordChanges.length > 0) {
        segments.push({
            content: '=== WORD-LEVEL CHANGES ===',
            type: 'unchanged',
            className: 'diff-header'
        });
        
        wordChanges.forEach(seg => {
            segments.push({
                content: seg.content,
                type: seg.type === 'word-added' ? 'added' : 'removed',
                className: seg.type === 'word-added' ? 'diff-added' : 'diff-removed'
            });
        });
        
        segments.push({
            content: '\n',
            type: 'unchanged',
            className: 'diff-unchanged'
        });
    }
    
    // Show unpaired line additions/removals
    const unpairedChanges = diffResult.unifiedDiff.filter(seg => 
        seg.type === 'line-added' || seg.type === 'line-removed'
    );
    
    if (unpairedChanges.length > 0) {
        segments.push({
            content: '\n=== UNPAIRED CHANGES ===',
            type: 'unchanged',
            className: 'diff-header'
        });
        
        unpairedChanges.forEach(seg => {
            segments.push({
                content: seg.content,
                type: seg.type === 'line-added' ? 'added' : 'removed',
                className: seg.type === 'line-added' ? 'diff-added' : 'diff-removed'
            });
        });
    }
    
    return segments;
}
