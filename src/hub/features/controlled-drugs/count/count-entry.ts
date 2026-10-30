import { parseCountRequest, type CountStatementRequest } from "./count-request-schema.ts";
import type { CountReadData } from "./count-read-wire.ts";

export interface CountStatementIdentity {
  readonly actor_id: string;
  readonly count_id: string;
  readonly snapshot_id: string;
  readonly operation_id: string;
  readonly statement_id: string;
}
export interface CountEntryFields {
  readonly observedAt: string;
  readonly observedOffset: string;
  readonly quantities: Readonly<Record<string, string>>;
  readonly presence: Readonly<Record<string, "present" | "missing" | "">>;
  readonly findings: readonly { readonly location_id: string; readonly description: string }[];
  readonly attest: boolean;
}

/** Decimal text stays decimal text: no binary floating point or dose conversion. */
export function countQuantityInput(value: string): string {
  const match = /^(0|[1-9][0-9]{0,10})(?:\.([0-9]{1,3}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a nonnegative quantity with up to three decimal places.");
  return `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}`;
}

export interface CountObservationChoice { readonly instant: string; readonly offset: string }
/** List actual instants for this wall time, including repeated fall-back times. */
export function countObservationChoices(value: string): readonly CountObservationChoice[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Enter when you observed the stock.");
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part ?? "0"));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    throw new Error("Enter a valid observation date and time.");
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
    date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second)
    throw new Error("That local time does not exist. Check the observation date and time.");
  const instants: Date[] = [];
  // Search independently on both sides, including non-hour civil-clock changes.
  for (let deltaMinute = -26 * 60; deltaMinute <= 26 * 60; deltaMinute++) {
    const candidate = new Date(date.getTime() + deltaMinute * 60000);
    if (candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day &&
      candidate.getHours() === hour && candidate.getMinutes() === minute && candidate.getSeconds() === second) instants.push(candidate);
  }
  return Object.freeze(instants.map(instant => {
    const iso = instant.toISOString();
    if (!/^\d{4}-/.test(iso)) throw new Error("Observation time is outside the supported calendar.");
    const minutes = -instant.getTimezoneOffset(), magnitude = Math.abs(minutes);
    const offset = `${minutes < 0 ? "-" : "+"}${String(Math.floor(magnitude / 60)).padStart(2, "0")}:${String(magnitude % 60).padStart(2, "0")}`;
    return Object.freeze({ instant: iso.replace(/\.000Z$/, ".000000Z"), offset });
  }));
}

export function countObservationTime(value: string, offset = ""): string {
  const choices = countObservationChoices(value);
  if (!offset && choices.length === 1) return choices[0].instant;
  const chosen = choices.filter(choice => choice.offset === offset);
  if (chosen.length !== 1) throw new Error("That local time occurs twice. Choose the UTC offset for your observation.");
  return chosen[0].instant;
}

/** Only exact captured membership reaches the immutable statement request. */
export function buildCountStatement(identity: CountStatementIdentity, data: CountReadData, fields: CountEntryFields): CountStatementRequest {
  if (!fields.attest) throw new Error("Confirm that these are your own observations.");
  if (identity.count_id !== data.count_id || identity.snapshot_id !== data.snapshot_id ||
    !data.participants.some(person => person.id === identity.actor_id && !person.submitted) ||
    data.own_statement !== null || data.history_state !== "collecting" || data.current_boundary_state !== "unchanged")
    throw new Error("Refresh this count before recording an observation.");
  const unitIds = data.units.map(unit => unit.cell_id), containerIds = data.containers.map(container => container.container_id);
  const exactKeys = (record: object, ids: readonly string[]) => {
    const keys = Object.keys(record);
    return keys.length === ids.length && ids.every(id => Object.prototype.hasOwnProperty.call(record, id));
  };
  if (!exactKeys(fields.quantities, unitIds) || !exactKeys(fields.presence, containerIds))
    throw new Error("Record every captured stock position and container.");
  if (fields.findings.some(finding => !data.locations.some(location => location.id === finding.location_id)))
    throw new Error("Select a captured location for each finding.");
  return parseCountRequest("statement", {
    schema_version: 1, ...identity, method: "manual_count", observed_at: countObservationTime(fields.observedAt, fields.observedOffset),
    quantities: data.units.map(unit => ({ cell_id: unit.cell_id, quantity: countQuantityInput(fields.quantities[unit.cell_id]) })),
    container_checks: data.containers.map(container => ({ container_id: container.container_id, presence: fields.presence[container.container_id] })),
    findings: fields.findings.map(finding => ({ ...finding })),
  });
}
