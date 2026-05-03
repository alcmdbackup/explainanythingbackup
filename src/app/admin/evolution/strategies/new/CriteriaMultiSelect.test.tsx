// Tests for CriteriaMultiSelect inline popover.

import { render, screen, fireEvent } from '@testing-library/react';
import { CriteriaMultiSelect } from './CriteriaMultiSelect';
import type { CriteriaListItem } from '@evolution/services/criteriaActions';

const mkCrit = (id: string, name: string): CriteriaListItem => ({
  id,
  name,
  description: null,
  min_rating: 1,
  max_rating: 5,
  evaluation_guidance: null,
  status: 'active',
  is_test_content: false,
  archived_at: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

describe('CriteriaMultiSelect', () => {
  it('renders empty state with link when no active criteria', () => {
    render(<CriteriaMultiSelect availableCriteria={[]} selected={[]} onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/No active criteria/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create one/i })).toHaveAttribute('href', '/admin/evolution/criteria');
  });

  it('renders one row per available criterion', () => {
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'clarity'), mkCrit(C2, 'engagement'), mkCrit(C3, 'depth')]}
        selected={[]}
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('clarity')).toBeInTheDocument();
    expect(screen.getByText('engagement')).toBeInTheDocument();
    expect(screen.getByText('depth')).toBeInTheDocument();
  });

  it('search filters by name (case-insensitive)', () => {
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'clarity'), mkCrit(C2, 'engagement'), mkCrit(C3, 'depth')]}
        selected={[]}
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search criteria...'), { target: { value: 'CLAR' } });
    expect(screen.getByText('clarity')).toBeInTheDocument();
    expect(screen.queryByText('engagement')).not.toBeInTheDocument();
    expect(screen.queryByText('depth')).not.toBeInTheDocument();
  });

  it('search no-match shows quoted message', () => {
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'clarity')]}
        selected={[]}
        onChange={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search criteria...'), { target: { value: 'xyz' } });
    expect(screen.getByText(/No criteria matching "xyz"/)).toBeInTheDocument();
  });

  it('checkbox toggle calls onChange with the right ids', () => {
    const onChange = jest.fn();
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'clarity'), mkCrit(C2, 'engagement')]}
        selected={[]}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    expect(onChange).toHaveBeenCalledWith([C1]);
  });

  it('checkbox un-toggles a previously-selected id', () => {
    const onChange = jest.fn();
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'clarity'), mkCrit(C2, 'engagement')]}
        selected={[C1]}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkboxes[0]!);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('Select all selects every filtered criterion', () => {
    const onChange = jest.fn();
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'a'), mkCrit(C2, 'b'), mkCrit(C3, 'c')]}
        selected={[]}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Select all/i }));
    expect(onChange).toHaveBeenCalledWith([C1, C2, C3]);
  });

  it('Select all toggle becomes Deselect all when all are selected; deselects all', () => {
    const onChange = jest.fn();
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'a'), mkCrit(C2, 'b')]}
        selected={[C1, C2]}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Deselect all/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('Done button calls onClose', () => {
    const onClose = jest.fn();
    render(
      <CriteriaMultiSelect
        availableCriteria={[mkCrit(C1, 'a')]}
        selected={[]}
        onChange={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
