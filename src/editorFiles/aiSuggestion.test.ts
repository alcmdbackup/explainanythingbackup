/**
 * Tests for aiSuggestion.ts (Phase 7D)
 * Tests AI suggestion schema validation, prompt generation, and output processing
 */

import {
  aiSuggestionSchema,
  createAISuggestionPrompt,
  createApplyEditsPrompt,
  mergeAISuggestionOutput,
  validateAISuggestionOutput,
  type AISuggestionOutput,
} from './aiSuggestion';

// ============= Schema Validation Tests =============

describe('aiSuggestionSchema - Validation Rules', () => {
  it('should accept valid alternating pattern starting with content', () => {
    const valid = {
      edits: ['Content 1', '... existing text ...', 'Content 2'],
    };

    const result = aiSuggestionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept valid alternating pattern ending with marker', () => {
    const valid = {
      edits: ['Content 1', '... existing text ...', 'Content 2', '... existing text ...'],
    };

    const result = aiSuggestionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept single content item', () => {
    const valid = {
      edits: ['Single content piece'],
    };

    const result = aiSuggestionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject empty edits array', () => {
    const invalid = {
      edits: [],
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject pattern starting with marker at even index', () => {
    const invalid = {
      edits: ['... existing text ...', 'Content 1'],
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject two consecutive content items', () => {
    const invalid = {
      edits: ['Content 1', 'Content 2'],
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject two consecutive markers', () => {
    const invalid = {
      edits: ['Content 1', '... existing text ...', '... existing text ...'],
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept complex valid pattern', () => {
    const valid = {
      edits: [
        'Introduction edited',
        '... existing text ...',
        'Middle section edited',
        '... existing text ...',
        'Conclusion edited',
      ],
    };

    const result = aiSuggestionSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject missing edits property', () => {
    const invalid = {};

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject non-array edits', () => {
    const invalid = {
      edits: 'not an array',
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject non-string array items', () => {
    const invalid = {
      edits: [123, '... existing text ...'],
    };

    const result = aiSuggestionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ============= Prompt Generation Tests =============

describe('createAISuggestionPrompt - Prompt Generation', () => {
  const defaultUserPrompt = 'Improve the content';

  it('should include current text in prompt', () => {
    const text = 'This is the original content';
    const prompt = createAISuggestionPrompt(text, defaultUserPrompt);

    expect(prompt).toContain(text);
  });

  it('should include output format instructions', () => {
    const prompt = createAISuggestionPrompt('test content', defaultUserPrompt);

    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('JSON object');
    expect(prompt).toContain('edits');
  });

  it('should include rules section', () => {
    const prompt = createAISuggestionPrompt('test content', defaultUserPrompt);

    expect(prompt).toContain('<rules>');
    expect(prompt).toContain('... existing text ...');
  });

  it('should include example', () => {
    const prompt = createAISuggestionPrompt('test content', defaultUserPrompt);

    expect(prompt).toContain('Example:');
    expect(prompt).toContain('"edits"');
  });

  it('should handle empty content', () => {
    const prompt = createAISuggestionPrompt('', defaultUserPrompt);

    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100); // Should have template text
  });

  it('should handle multiline content', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const prompt = createAISuggestionPrompt(text, defaultUserPrompt);

    expect(prompt).toContain(text);
  });

  it('should handle special characters in content', () => {
    const text = 'Content with "quotes" and <tags>';
    const prompt = createAISuggestionPrompt(text, defaultUserPrompt);

    expect(prompt).toContain(text);
  });

  it('should maintain consistent prompt structure', () => {
    const prompt1 = createAISuggestionPrompt('content 1', defaultUserPrompt);
    const prompt2 = createAISuggestionPrompt('content 2', defaultUserPrompt);

    // Both should have same structure, different content
    expect(prompt1).toContain('<output_format>');
    expect(prompt2).toContain('<output_format>');
    expect(prompt1).toContain('<rules>');
    expect(prompt2).toContain('<rules>');
  });
});

describe('createApplyEditsPrompt - Apply Edits Prompt', () => {
  it('should include AI suggestions', () => {
    const suggestions = 'Edited content\n... existing text ...';
    const original = 'Original content';
    const prompt = createApplyEditsPrompt(suggestions, original);

    expect(prompt).toContain(suggestions);
  });

  it('should include original content', () => {
    const suggestions = 'Edited content';
    const original = 'Original content here';
    const prompt = createApplyEditsPrompt(suggestions, original);

    expect(prompt).toContain(original);
  });

  it('should include instructions', () => {
    const prompt = createApplyEditsPrompt('suggestions', 'original');

    expect(prompt).toContain('IMPORTANT RULES');
    expect(prompt).toContain('Apply');
  });

  it('should include markers explanation', () => {
    const prompt = createApplyEditsPrompt('suggestions', 'original');

    expect(prompt).toContain('... existing text ...');
  });

  it('should separate suggestions and original content', () => {
    const prompt = createApplyEditsPrompt('suggestions', 'original');

    expect(prompt).toContain('== AI SUGGESTIONS ==');
    expect(prompt).toContain('== ORIGINAL CONTENT ==');
  });

  it('should handle empty suggestions', () => {
    const prompt = createApplyEditsPrompt('', 'original content');

    expect(prompt).toBeTruthy();
    expect(prompt).toContain('original content');
  });

  it('should handle empty original content', () => {
    const prompt = createApplyEditsPrompt('suggestions', '');

    expect(prompt).toBeTruthy();
    expect(prompt).toContain('suggestions');
  });
});

// ============= Output Processing Tests =============

describe('mergeAISuggestionOutput - Output Merging', () => {
  it('should merge single item', () => {
    const output: AISuggestionOutput = {
      edits: ['Single content'],
    };

    const result = mergeAISuggestionOutput(output);

    expect(result).toBe('Single content');
  });

  it('should merge multiple items with newlines', () => {
    const output: AISuggestionOutput = {
      edits: ['Content 1', '... existing text ...', 'Content 2'],
    };

    const result = mergeAISuggestionOutput(output);

    expect(result).toBe('Content 1\n... existing text ...\nContent 2');
  });

  it('should handle empty array edge case', () => {
    const output = { edits: [] } as any;

    const result = mergeAISuggestionOutput(output);

    expect(result).toBe('');
  });

  it('should preserve multiline content within items', () => {
    const output: AISuggestionOutput = {
      edits: ['Line 1\nLine 2', '... existing text ...'],
    };

    const result = mergeAISuggestionOutput(output);

    expect(result).toContain('Line 1\nLine 2');
  });

  it('should handle special characters', () => {
    const output: AISuggestionOutput = {
      edits: ['Content with "quotes"', '... existing text ...', 'Content with <tags>'],
    };

    const result = mergeAISuggestionOutput(output);

    expect(result).toContain('"quotes"');
    expect(result).toContain('<tags>');
  });

  it('should maintain order of edits', () => {
    const output: AISuggestionOutput = {
      edits: ['First', 'Second', 'Third'],
    };

    const result = mergeAISuggestionOutput(output);

    expect(result).toBe('First\nSecond\nThird');
    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
    expect(result.indexOf('Second')).toBeLessThan(result.indexOf('Third'));
  });
});

// ============= Output Validation Tests =============

describe('validateAISuggestionOutput - Validation Function', () => {
  it('should validate correct JSON string', () => {
    const validJSON = JSON.stringify({
      edits: ['Content 1', '... existing text ...', 'Content 2'],
    });

    const result = validateAISuggestionOutput(validJSON);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.edits).toHaveLength(3);
    }
  });

  it('should reject invalid JSON', () => {
    const invalidJSON = 'not valid json {';

    const result = validateAISuggestionOutput(invalidJSON);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Invalid JSON');
    }
  });

  it('should reject valid JSON with invalid schema', () => {
    const invalidSchema = JSON.stringify({
      edits: ['... existing text ...', 'Content'],
    });

    const result = validateAISuggestionOutput(invalidSchema);

    expect(result.success).toBe(false);
  });

  it('should reject empty edits array', () => {
    const emptyEdits = JSON.stringify({
      edits: [],
    });

    const result = validateAISuggestionOutput(emptyEdits);

    expect(result.success).toBe(false);
  });

  it('should reject missing edits property', () => {
    const missingEdits = JSON.stringify({
      other: 'property',
    });

    const result = validateAISuggestionOutput(missingEdits);

    expect(result.success).toBe(false);
  });

  it('should handle valid complex pattern', () => {
    const complexValid = JSON.stringify({
      edits: [
        'Introduction',
        '... existing text ...',
        'Middle section',
        '... existing text ...',
        'Conclusion',
      ],
    });

    const result = validateAISuggestionOutput(complexValid);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.edits).toHaveLength(5);
    }
  });

  it('should return error for consecutive content items', () => {
    const consecutive = JSON.stringify({
      edits: ['Content 1', 'Content 2'],
    });

    const result = validateAISuggestionOutput(consecutive);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toBeDefined();
    }
  });

  it('should handle whitespace in JSON', () => {
    const withWhitespace = `
      {
        "edits": [
          "Content 1",
          "... existing text ...",
          "Content 2"
        ]
      }
    `;

    const result = validateAISuggestionOutput(withWhitespace);

    expect(result.success).toBe(true);
  });

  it('should preserve data structure on success', () => {
    const validJSON = JSON.stringify({
      edits: ['Test content', '... existing text ...', 'More content'],
    });

    const result = validateAISuggestionOutput(validJSON);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.edits[0]).toBe('Test content');
      expect(result.data.edits[1]).toBe('... existing text ...');
      expect(result.data.edits[2]).toBe('More content');
    }
  });
});

// ============= Edge Cases & Error Handling =============

describe('aiSuggestion - Edge Cases', () => {
  const defaultUserPrompt = 'Improve the content';

  it('should handle very long content in prompts', () => {
    const longContent = 'A'.repeat(10000);
    const prompt = createAISuggestionPrompt(longContent, defaultUserPrompt);

    expect(prompt).toContain(longContent);
    expect(prompt.length).toBeGreaterThan(10000);
  });

  it('should handle unicode characters in content', () => {
    const unicode = '你好世界 🌍 Здравствуй мир';
    const prompt = createAISuggestionPrompt(unicode, defaultUserPrompt);

    expect(prompt).toContain(unicode);
  });

  it('should handle markdown formatting in suggestions', () => {
    const output: AISuggestionOutput = {
      edits: ['**Bold** text', '... existing text ...', '*Italic* text'],
    };

    const merged = mergeAISuggestionOutput(output);

    expect(merged).toContain('**Bold**');
    expect(merged).toContain('*Italic*');
  });

  it('should handle code blocks in content', () => {
    const codeContent = '```javascript\nconst x = 1;\n```';
    const prompt = createAISuggestionPrompt(codeContent, defaultUserPrompt);

    expect(prompt).toContain(codeContent);
  });

  it('should validate nested JSON structures gracefully', () => {
    const nestedJSON = JSON.stringify({
      edits: ['Content'],
      nested: { prop: 'value' },
    });

    const result = validateAISuggestionOutput(nestedJSON);

    // Should succeed if edits array is valid, ignore extra properties
    expect(result.success).toBe(true);
  });
});

// ============= Integration-Style Tests =============

describe('aiSuggestion - Workflow Simulation', () => {
  const defaultUserPrompt = 'Improve the content';

  it('should complete full validation workflow', () => {
    // 1. Create prompt
    const content = 'Original content here';
    const prompt = createAISuggestionPrompt(content, defaultUserPrompt);
    expect(prompt).toContain(content);

    // 2. Simulate AI response
    const aiResponse = JSON.stringify({
      edits: ['Improved content', '... existing text ...', 'Enhanced ending'],
    });

    // 3. Validate response
    const validation = validateAISuggestionOutput(aiResponse);
    expect(validation.success).toBe(true);

    // 4. Merge output
    if (validation.success) {
      const merged = mergeAISuggestionOutput(validation.data);
      expect(merged).toContain('Improved content');
      expect(merged).toContain('Enhanced ending');
    }
  });

  it('should handle validation failure gracefully', () => {
    const invalidResponse = JSON.stringify({
      edits: ['... existing text ...', 'Content'],
    });

    const validation = validateAISuggestionOutput(invalidResponse);
    expect(validation.success).toBe(false);

    if (!validation.success) {
      expect(validation.error).toBeDefined();
      expect(validation.error.issues).toBeDefined();
    }
  });

  it('should create apply edits prompt from validated output', () => {
    const validJSON = JSON.stringify({
      edits: ['New intro', '... existing text ...'],
    });

    const validation = validateAISuggestionOutput(validJSON);
    expect(validation.success).toBe(true);

    if (validation.success) {
      const merged = mergeAISuggestionOutput(validation.data);
      const applyPrompt = createApplyEditsPrompt(merged, 'Original content');

      expect(applyPrompt).toContain('New intro');
      expect(applyPrompt).toContain('Original content');
    }
  });
});
