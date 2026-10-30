export function explicitBoolean(value: string): boolean { if (value !== "yes" && value !== "no") throw new Error("Choose Yes or No for every setting."); return value === "yes"; }
export function toggleValue<T>(values: readonly T[], value: T, selected: boolean): readonly T[] { return selected ? [...new Set([...values, value])] : values.filter(item => item !== value); }

export const yesNoChoices = Object.freeze([{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]);
