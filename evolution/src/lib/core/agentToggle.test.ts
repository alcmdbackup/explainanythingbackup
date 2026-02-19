// Contract tests for agent toggle logic used in strategy form UI.
// Tests dependency auto-enable, dependent auto-disable,
// and backward compatibility for editing strategies without enabledAgents.

import { toggleAgent } from './agentToggle';
import { OPTIONAL_AGENTS } from './budgetRedistribution';

const ALL_OPTIONAL = [...OPTIONAL_AGENTS] as string[];

describe('toggleAgent', () => {
  describe('basic toggle', () => {
    it('enables an agent when not present', () => {
      const result = toggleAgent([], 'reflection');
      expect(result).toContain('reflection');
    });

    it('disables an agent when present', () => {
      const result = toggleAgent(['reflection', 'debate'], 'reflection');
      expect(result).not.toContain('reflection');
      expect(result).toContain('debate');
    });
  });

  describe('dependency auto-enable', () => {
    it('enabling iterativeEditing auto-enables reflection', () => {
      const result = toggleAgent([], 'iterativeEditing');
      expect(result).toContain('iterativeEditing');
      expect(result).toContain('reflection');
    });

    it('enabling treeSearch auto-enables reflection', () => {
      const result = toggleAgent([], 'treeSearch');
      expect(result).toContain('treeSearch');
      expect(result).toContain('reflection');
    });

    it('enabling sectionDecomposition auto-enables reflection', () => {
      const result = toggleAgent([], 'sectionDecomposition');
      expect(result).toContain('sectionDecomposition');
      expect(result).toContain('reflection');
    });

    it('does not auto-enable required agents (tournament for evolution)', () => {
      // tournament is REQUIRED, so it shouldn't appear in the optional enabledAgents
      const result = toggleAgent([], 'evolution');
      expect(result).toContain('evolution');
      expect(result).not.toContain('tournament');
    });
  });

  describe('dependent auto-disable', () => {
    it('disabling reflection also disables iterativeEditing', () => {
      const result = toggleAgent(['reflection', 'iterativeEditing'], 'reflection');
      expect(result).not.toContain('reflection');
      expect(result).not.toContain('iterativeEditing');
    });

    it('disabling reflection also disables treeSearch', () => {
      const result = toggleAgent(['reflection', 'treeSearch'], 'reflection');
      expect(result).not.toContain('reflection');
      expect(result).not.toContain('treeSearch');
    });

    it('disabling reflection cascades to all dependents', () => {
      const result = toggleAgent(
        ['reflection', 'iterativeEditing', 'treeSearch', 'sectionDecomposition'],
        'reflection',
      );
      expect(result).not.toContain('reflection');
      expect(result).not.toContain('iterativeEditing');
      expect(result).not.toContain('treeSearch');
      expect(result).not.toContain('sectionDecomposition');
    });

    it('disabling reflection preserves non-dependent agents', () => {
      const result = toggleAgent(['reflection', 'iterativeEditing', 'debate'], 'reflection');
      expect(result).not.toContain('reflection');
      expect(result).toContain('debate');
    });
  });

  describe('treeSearch and iterativeEditing coexistence', () => {
    it('enabling treeSearch keeps iterativeEditing (no mutex)', () => {
      const result = toggleAgent(['reflection', 'iterativeEditing'], 'treeSearch');
      expect(result).toContain('treeSearch');
      expect(result).toContain('iterativeEditing');
      expect(result).toContain('reflection');
    });

    it('enabling iterativeEditing keeps treeSearch (no mutex)', () => {
      const result = toggleAgent(['reflection', 'treeSearch'], 'iterativeEditing');
      expect(result).toContain('iterativeEditing');
      expect(result).toContain('treeSearch');
      expect(result).toContain('reflection');
    });
  });

  describe('preset application backward compat', () => {
    it('toggling from all-enabled matches expected subset', () => {
      // Simulate "Balanced" preset: start from all, disable outlineGeneration + treeSearch
      let agents = ALL_OPTIONAL;
      agents = toggleAgent(agents, 'outlineGeneration');
      agents = toggleAgent(agents, 'treeSearch');
      expect(agents).toContain('reflection');
      expect(agents).toContain('iterativeEditing');
      expect(agents).toContain('debate');
      expect(agents).toContain('evolution');
      expect(agents).toContain('metaReview');
      expect(agents).not.toContain('outlineGeneration');
      expect(agents).not.toContain('treeSearch');
    });

    it('toggling from empty enables exactly the selected agent + deps', () => {
      const result = toggleAgent([], 'iterativeEditing');
      expect(result.sort()).toEqual(['iterativeEditing', 'reflection']);
    });
  });
});
