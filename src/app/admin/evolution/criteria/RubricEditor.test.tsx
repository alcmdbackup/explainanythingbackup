// Tests for RubricEditor: empty state, add/remove, range validation, sort order, callback shape.

import { render, screen, fireEvent } from '@testing-library/react';
import { RubricEditor, type RubricAnchor } from './RubricEditor';

describe('RubricEditor', () => {
  function setup(initial?: ReadonlyArray<RubricAnchor> | null, range = { min: 1, max: 5 }) {
    const onChange = jest.fn();
    const utils = render(
      <RubricEditor
        value={initial}
        onChange={onChange}
        minRating={range.min}
        maxRating={range.max}
      />,
    );
    return { onChange, ...utils };
  }

  it('empty-state renders the placeholder when value is null', () => {
    setup(null);
    expect(screen.getByText(/No rubric defined/i)).toBeInTheDocument();
  });

  it('empty-state renders the placeholder when value is empty array', () => {
    setup([]);
    expect(screen.getByText(/No rubric defined/i)).toBeInTheDocument();
  });

  it('renders one row per anchor when populated', () => {
    setup([
      { score: 1, description: 'low' },
      { score: 5, description: 'high' },
    ]);
    expect(screen.getByDisplayValue('low')).toBeInTheDocument();
    expect(screen.getByDisplayValue('high')).toBeInTheDocument();
  });

  it('renders anchors sorted by score ascending regardless of insertion order', () => {
    const { container } = setup([
      { score: 5, description: 'high' },
      { score: 1, description: 'low' },
      { score: 3, description: 'mid' },
    ]);
    const inputs = container.querySelectorAll('input[type="text"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('low');
    expect((inputs[1] as HTMLInputElement).value).toBe('mid');
    expect((inputs[2] as HTMLInputElement).value).toBe('high');
  });

  it('Add anchor button appends a row with score=minRating', () => {
    const { onChange } = setup([], { min: 2, max: 8 });
    fireEvent.click(screen.getByTestId('rubric-add-anchor'));
    expect(onChange).toHaveBeenCalledWith([{ score: 2, description: '' }]);
  });

  it('removing an anchor calls onChange without that row', () => {
    const { onChange } = setup([
      { score: 1, description: 'low' },
      { score: 5, description: 'high' },
    ]);
    const removeButtons = screen.getAllByLabelText('Remove anchor');
    fireEvent.click(removeButtons[0]!); // remove low
    expect(onChange).toHaveBeenCalledWith([{ score: 5, description: 'high' }]);
  });

  it('flags out-of-range score with aria-invalid + red border + tooltip', () => {
    setup([{ score: 99, description: 'outside' }], { min: 1, max: 5 });
    const scoreInput = screen.getByDisplayValue('99');
    expect(scoreInput).toHaveAttribute('aria-invalid', 'true');
    expect((scoreInput as HTMLInputElement).className).toContain('red-500');
    expect(scoreInput).toHaveAttribute('title', expect.stringContaining('between 1 and 5'));
  });

  it('flags empty description with aria-invalid + red border', () => {
    setup([{ score: 3, description: '' }]);
    const inputs = screen.getAllByPlaceholderText('What does this score mean?');
    expect(inputs[0]).toHaveAttribute('aria-invalid', 'true');
  });

  it('description input enforces maxLength=500', () => {
    setup([{ score: 3, description: 'foo' }]);
    const desc = screen.getByDisplayValue('foo');
    expect(desc).toHaveAttribute('maxLength', '500');
  });

  it('editing a score field calls onChange with the patched anchor', () => {
    const { onChange } = setup([{ score: 1, description: 'low' }]);
    const scoreInput = screen.getByDisplayValue('1');
    fireEvent.change(scoreInput, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith([{ score: 4, description: 'low' }]);
  });

  it('editing a description field calls onChange with the patched anchor', () => {
    const { onChange } = setup([{ score: 1, description: 'low' }]);
    const desc = screen.getByDisplayValue('low');
    fireEvent.change(desc, { target: { value: 'awful' } });
    expect(onChange).toHaveBeenCalledWith([{ score: 1, description: 'awful' }]);
  });

  it('syncs internal state when value prop changes (dialog reopen with different row)', () => {
    const { rerender, container } = render(
      <RubricEditor value={[{ score: 1, description: 'a' }]} onChange={() => {}} minRating={1} maxRating={5} />,
    );
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(1);
    rerender(
      <RubricEditor value={[{ score: 1, description: 'b' }, { score: 5, description: 'c' }]} onChange={() => {}} minRating={1} maxRating={5} />,
    );
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(2);
  });
});
