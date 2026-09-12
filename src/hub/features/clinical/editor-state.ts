import { practiceAddress } from '../../../config/practice.ts';

export interface EncounterDraft {
  visit_at: string;
  visit_type: 'clinic' | 'housecall';
  location: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export function denverDateTime(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

// Match an actual Denver instant, rejecting nonexistent spring-forward times.
// Ambiguous fall-back times are rejected so staff can choose an unambiguous time.
export function denverInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid visit date and time.');
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) throw new Error('Enter a valid visit date and time.');
  const candidates = [6, 7].map(offset => new Date(wall + offset * 3600000)).filter(date => denverDateTime(date) === value);
  if (candidates.length !== 1) throw new Error('This Denver time is skipped or repeated by daylight saving. Choose an unambiguous visit time.');
  return candidates[0].toISOString();
}

export function newEncounter(): EncounterDraft {
  return { visit_at: denverDateTime(new Date()), visit_type: 'clinic', location: practiceAddress, subjective: '', objective: '', assessment: '', plan: '' };
}

export function encounterDraft(row: Omit<EncounterDraft, 'location' | 'visit_type'> & { location: string | null; visit_type: string }): EncounterDraft {
  return { visit_at: denverDateTime(row.visit_at), visit_type: row.visit_type === 'housecall' ? 'housecall' : 'clinic', location: row.location ?? '', subjective: row.subjective, objective: row.objective, assessment: row.assessment, plan: row.plan };
}

export function errorText(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The request could not be completed.';
  if (/fetch|network|timeout|timed out/i.test(message)) return 'The connection was interrupted. Your text is preserved, but the save may have completed. Inspect the latest saved history before retrying to avoid duplicate records.';
  return /version|conflict|changed by|stale/i.test(message) ? 'Another person changed this record. Your draft is preserved. Reload the latest record to discard your changes, then review before editing.' : message;
}
