// Tests for L8 orthogonal array generation, factor mapping, and orthogonality verification.

import {
  L8_ARRAY,
  generateL8Design,
  mapFactorsToPipelineArgs,
  verifyOrthogonality,
  verifyFullOrthogonality,
  generateFullFactorial,
} from './factorial';

describe('L8 Orthogonal Array', () => {
  it('has exactly 8 rows and 7 columns', () => {
    expect(L8_ARRAY).toHaveLength(8);
    for (const row of L8_ARRAY) {
      expect(row).toHaveLength(7);
    }
  });

  it('contains only -1 and +1 values', () => {
    for (const row of L8_ARRAY) {
      for (const val of row) {
        expect([-1, 1]).toContain(val);
      }
    }
  });

  it('has balanced columns (4 highs, 4 lows per column)', () => {
    for (let col = 0; col < 7; col++) {
      const highs = L8_ARRAY.filter((row) => row[col] === 1).length;
      const lows = L8_ARRAY.filter((row) => row[col] === -1).length;
      expect(highs).toBe(4);
      expect(lows).toBe(4);
    }
  });

  it('all column pairs are orthogonal', () => {
    expect(verifyFullOrthogonality(L8_ARRAY)).toBe(true);
  });

  it('verifyOrthogonality returns false for same column', () => {
    expect(verifyOrthogonality(L8_ARRAY, 0, 0)).toBe(false);
  });

  it('verifyOrthogonality returns true for different columns', () => {
    expect(verifyOrthogonality(L8_ARRAY, 0, 1)).toBe(true);
    expect(verifyOrthogonality(L8_ARRAY, 2, 5)).toBe(true);
  });
});

describe('generateL8Design', () => {
  it('generates a valid design with default round 1 factors', () => {
    const design = generateL8Design();
    expect(design.type).toBe('L8');
    expect(design.runs).toHaveLength(8);
    expect(Object.keys(design.factors)).toHaveLength(5);
  });

  it('assigns factors A-E to columns 0-4', () => {
    const design = generateL8Design();
    expect(design.assignments).toHaveLength(5);
    expect(design.assignments[0].column).toBe(0);
    expect(design.assignments[0].factor.name).toBe('genModel');
    expect(design.assignments[4].column).toBe(4);
    expect(design.assignments[4].factor.name).toBe('supportAgents');
  });

  it('reports interaction columns for unassigned columns', () => {
    const design = generateL8Design();
    expect(design.interactionColumns).toHaveLength(2);
    expect(design.interactionColumns[0].label).toBe('A×C');
    expect(design.interactionColumns[1].label).toBe('A×E');
  });

  it('maps row 1 to all-low values', () => {
    const design = generateL8Design();
    const run1 = design.runs[0];
    expect(run1.row).toBe(1);
    expect(run1.factors.genModel).toBe('deepseek-chat');
    expect(run1.factors.judgeModel).toBe('gpt-5-nano');
    expect(run1.factors.iterations).toBe(3);
    expect(run1.factors.editor).toBe('iterativeEditing');
    expect(run1.factors.supportAgents).toBe('off');
  });

  it('maps row 8 correctly per L8 matrix', () => {
    const design = generateL8Design();
    const run8 = design.runs[7];
    expect(run8.row).toBe(8);
    expect(run8.factors.genModel).toBe('gpt-5-mini');
    expect(run8.factors.judgeModel).toBe('gpt-4.1-nano');
    expect(run8.factors.iterations).toBe(8);
    expect(run8.factors.editor).toBe('iterativeEditing');
    expect(run8.factors.supportAgents).toBe('on');
  });

  it('throws if more than 7 factors are provided', () => {
    const factors: Record<string, { name: string; label: string; low: string; high: string }> = {};
    for (let i = 0; i < 8; i++) {
      factors[String.fromCharCode(65 + i)] = { name: `f${i}`, label: `Factor ${i}`, low: 'lo', high: 'hi' };
    }
    expect(() => generateL8Design(factors)).toThrow('L8 supports at most 7 factors');
  });

  it('works with custom factors', () => {
    const custom = {
      X: { name: 'speed', label: 'Speed', low: 'slow' as string | number, high: 'fast' as string | number },
      Y: { name: 'quality', label: 'Quality', low: 1 as string | number, high: 10 as string | number },
    };
    const design = generateL8Design(custom);
    expect(design.runs).toHaveLength(8);
    expect(design.runs[0].factors.speed).toBe('slow');
    expect(design.runs[0].factors.quality).toBe(1);
  });
});

describe('mapFactorsToPipelineArgs', () => {
  it('maps iterativeEditing + off to [iterativeEditing, reflection]', () => {
    const args = mapFactorsToPipelineArgs({
      genModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
      editor: 'iterativeEditing',
      supportAgents: 'off',
    });
    expect(args.model).toBe('deepseek-chat');
    expect(args.judgeModel).toBe('gpt-4.1-nano');
    expect(args.iterations).toBe(3);
    expect(args.enabledAgents).toEqual(['iterativeEditing', 'reflection']);
  });

  it('maps treeSearch + off to [treeSearch, reflection]', () => {
    const args = mapFactorsToPipelineArgs({
      editor: 'treeSearch',
      supportAgents: 'off',
    });
    expect(args.enabledAgents).toEqual(['treeSearch', 'reflection']);
  });

  it('maps iterativeEditing + on to full agent suite', () => {
    const args = mapFactorsToPipelineArgs({
      editor: 'iterativeEditing',
      supportAgents: 'on',
    });
    expect(args.enabledAgents).toContain('iterativeEditing');
    expect(args.enabledAgents).toContain('reflection');
    expect(args.enabledAgents).toContain('debate');
    expect(args.enabledAgents).toContain('evolution');
    expect(args.enabledAgents).toContain('sectionDecomposition');
    expect(args.enabledAgents).toContain('metaReview');
    expect(args.enabledAgents).not.toContain('treeSearch');
  });

  it('maps treeSearch + on to full agent suite without iterativeEditing', () => {
    const args = mapFactorsToPipelineArgs({
      editor: 'treeSearch',
      supportAgents: 'on',
    });
    expect(args.enabledAgents).toContain('treeSearch');
    expect(args.enabledAgents).toContain('reflection');
    expect(args.enabledAgents).not.toContain('iterativeEditing');
  });
});

describe('generateFullFactorial', () => {
  it('generates correct Cartesian product for 2 factors x 2 levels', () => {
    const result = generateFullFactorial([
      { name: 'a', label: 'A', levels: [1, 2] },
      { name: 'b', label: 'B', levels: ['x', 'y'] },
    ]);
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ a: 1, b: 'x' });
    expect(result).toContainEqual({ a: 1, b: 'y' });
    expect(result).toContainEqual({ a: 2, b: 'x' });
    expect(result).toContainEqual({ a: 2, b: 'y' });
  });

  it('handles 3 levels correctly', () => {
    const result = generateFullFactorial([
      { name: 'iterations', label: 'Iterations', levels: [3, 5, 8] },
    ]);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ iterations: 3 });
    expect(result).toContainEqual({ iterations: 5 });
    expect(result).toContainEqual({ iterations: 8 });
  });

  it('returns single empty object for empty factors', () => {
    const result = generateFullFactorial([]);
    expect(result).toEqual([{}]);
  });
});
