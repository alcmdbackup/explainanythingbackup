import {
  createExplanationPrompt,
  createTitlePrompt,
  createStandaloneTitlePrompt,
  createMatchSelectionPrompt,
  createTagEvaluationPrompt,
  editExplanationPrompt,
} from './prompts';

describe('prompts', () => {
  describe('createExplanationPrompt', () => {
    it('should generate prompt with no additional rules', () => {
      const result = createExplanationPrompt('Quantum Computing', []);
      expect(result).toMatchSnapshot();
    });

    it('should generate prompt with single additional rule', () => {
      const result = createExplanationPrompt('Quantum Computing', ['Use simple language']);
      expect(result).toMatchSnapshot();
    });

    it('should generate prompt with multiple additional rules', () => {
      const result = createExplanationPrompt('Machine Learning', [
        'Include examples',
        'Use simple analogies',
        'Avoid jargon',
      ]);
      expect(result).toMatchSnapshot();
    });

    it('should handle special characters in title', () => {
      const result = createExplanationPrompt('C++ Programming & Design', []);
      expect(result).toMatchSnapshot();
    });

    it('should handle empty string title', () => {
      const result = createExplanationPrompt('', []);
      expect(result).toMatchSnapshot();
    });

    it('should handle very long title', () => {
      const longTitle = 'The Complete History of Artificial Intelligence and Machine Learning from the 1950s to Present Day';
      const result = createExplanationPrompt(longTitle, []);
      expect(result).toMatchSnapshot();
    });

    it('should include title in output', () => {
      const result = createExplanationPrompt('Test Topic', []);
      expect(result).toContain('Test Topic');
    });

    it('should include markdown formatting rules', () => {
      const result = createExplanationPrompt('Test', []);
      expect(result).toContain('Markdown');
      expect(result).toContain('##');
    });
  });

  describe('createTitlePrompt', () => {
    it('should generate prompt with typical user input', () => {
      const result = createTitlePrompt('How do quantum computers work?');
      expect(result).toMatchSnapshot();
    });

    it('should handle multi-line user input', () => {
      const result = createTitlePrompt('How do quantum computers work?\nWhat are qubits?');
      expect(result).toMatchSnapshot();
    });

    it('should handle special characters', () => {
      const result = createTitlePrompt('C++ vs Rust: Which is better?');
      expect(result).toMatchSnapshot();
    });

    it('should handle empty string', () => {
      const result = createTitlePrompt('');
      expect(result).toMatchSnapshot();
    });

    it('should handle very long input', () => {
      const longInput = 'I want to understand the complete history and evolution of quantum computing from its theoretical foundations in the 1980s to modern applications in cryptography and optimization';
      const result = createTitlePrompt(longInput);
      expect(result).toMatchSnapshot();
    });

    it('should include user input in markdown blockquote', () => {
      const result = createTitlePrompt('Test query');
      expect(result).toContain('> *Test query*');
    });

    it('should include title principles table', () => {
      const result = createTitlePrompt('Test');
      expect(result).toContain('Recognizable');
      expect(result).toContain('Natural');
      expect(result).toContain('Concise');
      expect(result).toContain('Precise');
      expect(result).toContain('Consistent');
    });
  });

  describe('createStandaloneTitlePrompt', () => {
    it('should generate prompt with single subsection title', () => {
      const result = createStandaloneTitlePrompt('Machine Learning', ['Introduction']);
      expect(result).toMatchSnapshot();
    });

    it('should generate prompt with multiple subsection titles', () => {
      const result = createStandaloneTitlePrompt('Quantum Computing', [
        'Introduction',
        'Qubits',
        'Quantum Gates',
        'Applications',
      ]);
      expect(result).toMatchSnapshot();
    });

    it('should handle empty subsectionTitles array', () => {
      const result = createStandaloneTitlePrompt('Test Article', []);
      expect(result).toMatchSnapshot();
    });

    it('should handle special characters in titles', () => {
      const result = createStandaloneTitlePrompt('C++ Programming', [
        'Classes & Objects',
        'Memory Management',
      ]);
      expect(result).toMatchSnapshot();
    });

    it('should number subsections correctly', () => {
      const result = createStandaloneTitlePrompt('Test', ['First', 'Second', 'Third']);
      expect(result).toContain('1. "First"');
      expect(result).toContain('2. "Second"');
      expect(result).toContain('3. "Third"');
    });

    it('should include JSON format instructions', () => {
      const result = createStandaloneTitlePrompt('Test', ['Title']);
      expect(result).toContain('JSON');
      expect(result).toContain('"titles"');
    });

    it('should include article title in output', () => {
      const result = createStandaloneTitlePrompt('Neural Networks', ['Basics']);
      expect(result).toContain('Neural Networks');
    });
  });

  describe('createMatchSelectionPrompt', () => {
    it('should generate prompt with typical inputs', () => {
      const matches = '1. Quantum Computing Overview\n2. Introduction to Qubits';
      const result = createMatchSelectionPrompt('How do quantum computers work?', matches);
      expect(result).toMatchSnapshot();
    });

    it('should handle empty formattedMatches', () => {
      const result = createMatchSelectionPrompt('Test query', '');
      expect(result).toMatchSnapshot();
    });

    it('should handle special characters in query', () => {
      const result = createMatchSelectionPrompt('C++ vs Rust: Which is better?', 'Match 1');
      expect(result).toMatchSnapshot();
    });

    it('should include user query in output', () => {
      const result = createMatchSelectionPrompt('Test query', 'Match 1');
      expect(result).toContain('Test query');
    });

    it('should include 0-5 integer instruction', () => {
      const result = createMatchSelectionPrompt('Test', 'Match');
      expect(result).toContain('0 and 5');
    });

    it('should include formatted matches in output', () => {
      const matches = '1. Match One\n2. Match Two';
      const result = createMatchSelectionPrompt('Query', matches);
      expect(result).toContain('1. Match One');
      expect(result).toContain('2. Match Two');
    });
  });

  describe('createTagEvaluationPrompt', () => {
    it('should generate prompt with typical inputs', () => {
      const result = createTagEvaluationPrompt(
        'Quantum Computing',
        'Quantum computing uses qubits to perform calculations...'
      );
      expect(result).toMatchSnapshot();
    });

    it('should handle long content', () => {
      const longContent = 'A'.repeat(2000);
      const result = createTagEvaluationPrompt('Test', longContent);
      expect(result).toMatchSnapshot();
    });

    it('should handle short content', () => {
      const result = createTagEvaluationPrompt('Test', 'Brief explanation.');
      expect(result).toMatchSnapshot();
    });

    it('should include all tag categories (1-10)', () => {
      const result = createTagEvaluationPrompt('Test', 'Content');
      expect(result).toContain('BEGINNER (1)');
      expect(result).toContain('NORMAL (2)');
      expect(result).toContain('EXPERT (3)');
      expect(result).toContain('SHORT (4)');
      expect(result).toContain('MEDIUM (5)');
      expect(result).toContain('LONG (6)');
      expect(result).toContain('has_example (7)');
      expect(result).toContain('sequential (8)');
      expect(result).toContain('has_metaphor (9)');
      expect(result).toContain('instructional (10)');
    });

    it('should include JSON format instructions', () => {
      const result = createTagEvaluationPrompt('Test', 'Content');
      expect(result).toContain('JSON');
      expect(result).toContain('difficultyLevel');
      expect(result).toContain('length');
      expect(result).toContain('simpleTags');
    });

    it('should include title and content in output', () => {
      const result = createTagEvaluationPrompt('Test Title', 'Test Content');
      expect(result).toContain('Test Title');
      expect(result).toContain('Test Content');
    });

    it('should handle special characters in title and content', () => {
      const result = createTagEvaluationPrompt(
        'C++ & Rust',
        'Content with "quotes" and special chars'
      );
      expect(result).toMatchSnapshot();
    });
  });

  describe('editExplanationPrompt', () => {
    it('should generate prompt with typical inputs', () => {
      const result = editExplanationPrompt(
        'Quantum Computing',
        ['Use simple language'],
        'Existing explanation content...'
      );
      expect(result).toMatchSnapshot();
    });

    it('should handle empty additionalRules', () => {
      const result = editExplanationPrompt('Test', [], 'Existing content');
      expect(result).toMatchSnapshot();
    });

    it('should handle multiple additional rules', () => {
      const result = editExplanationPrompt(
        'Machine Learning',
        ['Include examples', 'Use analogies', 'Avoid jargon'],
        'Existing content'
      );
      expect(result).toMatchSnapshot();
    });

    it('should handle long existing content', () => {
      const longContent = 'A'.repeat(3000);
      const result = editExplanationPrompt('Test', [], longContent);
      expect(result).toMatchSnapshot();
    });

    it('should handle empty existing content', () => {
      const result = editExplanationPrompt('Test', [], '');
      expect(result).toMatchSnapshot();
    });

    it('should include user input in output', () => {
      const result = editExplanationPrompt('Test Topic', [], 'Content');
      expect(result).toContain('Test Topic');
    });

    it('should include existing content in output', () => {
      const result = editExplanationPrompt('Test', [], 'Existing content here');
      expect(result).toContain('Existing content here');
    });

    it('should include markdown formatting rules', () => {
      const result = editExplanationPrompt('Test', [], 'Content');
      expect(result).toContain('Markdown');
      expect(result).toContain('##');
    });

    it('should include preservation instructions', () => {
      const result = editExplanationPrompt('Test', [], 'Content');
      expect(result).toContain('Preserve the overall structure');
      expect(result).toContain('Make only necessary changes');
    });
  });
});
