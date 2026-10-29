import { useState, type InputHTMLAttributes } from 'react';
import { formatFormulaInput } from './formulaNumbers';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

export default function FormulaNumberInput({ value, onChange, onFocus, onBlur, ...props }: Props) {
  const [editing, setEditing] = useState(false);
  return <input {...props} type="number" value={editing ? value : formatFormulaInput(value)}
    onFocus={event => { setEditing(true); onFocus?.(event); }}
    onBlur={event => { setEditing(false); onBlur?.(event); }}
    onChange={event => onChange(event.target.value)} />;
}
