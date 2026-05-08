// Mode B sibling of IterativeEditingAgent. Inherits all behavior from the
// parent; overrides only `name` (so agent_name in evolution_agent_invocations
// records the correct mode for analytics) and `isRewriteMode` (so the parent's
// execute() branches into the rewrite + diff proposer pathway). All cycle
// scaffolding, validation, approver, apply, and ranking logic is shared.

import { IterativeEditingAgent } from './IterativeEditingAgent';

export class IterativeEditingRewriteAgent extends IterativeEditingAgent {
  readonly name: string = 'iterative_editing_rewrite';
  protected get isRewriteMode(): boolean { return true; }
}
