'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';
import { exportMarkdownReadOnly } from './importExportUtils';
import { MutationOp } from '@/reducers/pageLifecycleReducer';

interface MutationQueuePluginProps {
  pendingMutations: MutationOp[];
  processingMutation: MutationOp | null;
  onStartMutation: (id: string) => void;
  onCompleteMutation: (id: string, newContent: string) => void;
  onFailMutation: (id: string, error: string) => void;
}

/**
 * MutationQueuePlugin - Processes accept/reject mutations serially from the reducer queue
 *
 * This plugin:
 * 1. Watches for pending mutations in the queue
 * 2. Processes one mutation at a time
 * 3. Calls acceptDiffTag/rejectDiffTag to execute the mutation
 * 4. Dispatches completion/failure callbacks to update reducer state
 *
 * Edge cases handled:
 * - Node not found: If nodeKey no longer exists, mutation is a no-op but still completes
 * - Rapid clicks: All mutations are queued, processed serially
 * - Errors: Caught and reported via onFailMutation
 */
export default function MutationQueuePlugin({
  pendingMutations,
  processingMutation,
  onStartMutation,
  onCompleteMutation,
  onFailMutation,
}: MutationQueuePluginProps) {
  const [editor] = useLexicalComposerContext();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    // Don't start if already processing or reducer says we're processing
    if (isProcessingRef.current || processingMutation !== null) return;
    if (pendingMutations.length === 0) return;

    // Get the first pending mutation
    const nextMutation = pendingMutations.find(m => m.status === 'pending');
    if (!nextMutation) return;

    // Mark as processing locally to prevent re-entry
    isProcessingRef.current = true;
    onStartMutation(nextMutation.id);

    // Process the mutation asynchronously
    const processMutation = async () => {
      try {
        // Execute accept or reject
        if (nextMutation.type === 'accept') {
          await acceptDiffTag(editor, nextMutation.nodeKey);
        } else {
          await rejectDiffTag(editor, nextMutation.nodeKey);
        }

        // Get updated content after mutation
        let newContent = '';
        editor.getEditorState().read(() => {
          newContent = exportMarkdownReadOnly();
        });

        onCompleteMutation(nextMutation.id, newContent);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('MutationQueuePlugin: Mutation failed', {
          id: nextMutation.id,
          nodeKey: nextMutation.nodeKey,
          error
        });
        onFailMutation(nextMutation.id, errorMessage);
      } finally {
        isProcessingRef.current = false;
      }
    };

    processMutation();
  }, [editor, pendingMutations, processingMutation, onStartMutation, onCompleteMutation, onFailMutation]);

  return null;
}
