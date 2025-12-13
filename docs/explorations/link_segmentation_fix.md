# Link Segmentation Fix

## Problem & Solution Summary

• **Problem**: Sentence tokenization was incorrectly splitting markdown links at `?` characters in URLs, breaking links like `[text](/url?param=value)` into separate "sentences"

• **Root Cause**: Both `Intl.Segmenter` and regex fallback treated `?` as sentence boundary punctuation, unaware that `?` inside markdown link URLs should be protected

• **Solution**: Added URL protection logic that temporarily replaces markdown link URLs with placeholders during sentence tokenization, then restores them afterward

• **Implementation**: Applied URL protection to both code paths - `Intl.Segmenter` (modern browsers) and regex fallback (older browsers/environments) - ensuring consistent behavior across all environments

• **Result**: Sentence tokenization now correctly preserves complete markdown links, enabling proper granular diffing at word level instead of falling back to atomic paragraph replacement

## Key Files & Functions Modified

• **File**: `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`
• **Main Function**: `sentenceTokens()` - handles sentence boundary detection with URL protection
• **Supporting Functions**: `buildParagraphMultiPassRuns()`, `alignSentencesBySimilarity()`
• **Used By**: `src/app/diffTest/page.tsx` and `src/app/editorTest/page.tsx` via `RenderCriticMarkupFromMDAstDiff()`