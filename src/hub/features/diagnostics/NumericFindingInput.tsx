import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { numericInput } from "./model";
interface Props {
  id: string;
  label: string;
  initial: number | null;
  onValue: (value: number | null) => void;
  onInvalid: (invalid: boolean) => void;
}
/** Preserve partially typed signs/exponents; an invalid edit cannot save the previous numeric value. */
export function NumericFindingInput({
  id,
  label,
  initial,
  onValue,
  onInvalid,
}: Props) {
  const [text, setText] = useState(initial === null ? "" : String(initial)),
    [invalid, setInvalid] = useState(false);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        aria-invalid={invalid}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const value = numericInput(e.target.value);
            setInvalid(false);
            onInvalid(false);
            onValue(value);
          } catch {
            setInvalid(true);
            onInvalid(true);
          }
        }}
      />
      {invalid && (
        <p className="text-sm text-destructive">
          Enter a complete finite number before saving.
        </p>
      )}
    </div>
  );
}
