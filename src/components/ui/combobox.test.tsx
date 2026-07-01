// Unit tests for the generic Combobox primitive.
// improvements_to_edit_page_evolution_20260630 Phase 4 (Task #10):
// covers the new `renderOption` and `keywords` props added for the /edit picker.

import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox, type ComboboxOption } from './combobox';
import { useState } from 'react';

function Harness({
  options,
  renderOption,
  initial = '',
}: {
  options: ComboboxOption[];
  renderOption?: (o: ComboboxOption) => React.ReactNode;
  initial?: string;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Combobox
      options={options}
      value={value}
      onChange={setValue}
      testId="combobox-input"
      renderOption={renderOption}
    />
  );
}

describe('Combobox', () => {
  it('renders default label when renderOption is not provided', () => {
    const options: ComboboxOption[] = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    render(<Harness options={options} />);
    fireEvent.focus(screen.getByTestId('combobox-input'));
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('uses renderOption to customize row content', () => {
    const options: ComboboxOption[] = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    render(
      <Harness
        options={options}
        renderOption={(o) => <span data-testid={`custom-${o.value}`}>Custom {o.label}</span>}
      />,
    );
    fireEvent.focus(screen.getByTestId('combobox-input'));
    expect(screen.getByTestId('custom-a')).toBeTruthy();
    expect(screen.getByText('Custom Alpha')).toBeTruthy();
  });

  it('filters by keywords in addition to label/value', () => {
    const options: ComboboxOption[] = [
      { value: 'a', label: 'Alpha', keywords: ['fast', 'red'] },
      { value: 'b', label: 'Beta', keywords: ['slow', 'blue'] },
    ];
    render(<Harness options={options} />);
    const input = screen.getByTestId('combobox-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'red' } });
    // Only Alpha matches "red" (via keywords)
    expect(screen.queryByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('data-testid on option row uses value (not index)', () => {
    const options: ComboboxOption[] = [
      { value: 'strategy-abc', label: 'Alpha' },
    ];
    render(<Harness options={options} />);
    fireEvent.focus(screen.getByTestId('combobox-input'));
    // Combobox testid pattern is `${idPrefix}-opt-${value}`; idPrefix default is 'combobox'
    expect(screen.getByTestId('combobox-opt-strategy-abc')).toBeTruthy();
  });

  it('selecting an option calls onChange with its value', () => {
    let selected = 'a';
    function Wrapper(): JSX.Element {
      return (
        <Combobox
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ]}
          value={selected}
          onChange={(v) => { selected = v; }}
          testId="combobox-input"
        />
      );
    }
    render(<Wrapper />);
    fireEvent.focus(screen.getByTestId('combobox-input'));
    fireEvent.mouseDown(screen.getByText('Beta'));
    expect(selected).toBe('b');
  });
});
