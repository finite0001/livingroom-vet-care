import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hub/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePatientProblems } from './queries';
import { errorText } from './editor-state';

interface PatientProblemsProps { petId: string; disabled?: boolean; onDirtyChange: (dirty: boolean) => void }
interface ProblemDraft { title: string; notes: string; onset_date: string; status: 'active' | 'resolved'; importance: 'routine' | 'high' }
const emptyProblem: ProblemDraft = { title: '', notes: '', onset_date: '', status: 'active', importance: 'routine' };
const toDraft = (row: Tables<'patient_problems'>): ProblemDraft => ({ title: row.title, notes: row.notes ?? '', onset_date: row.onset_date ?? '', status: row.status === 'resolved' ? 'resolved' : 'active', importance: row.importance === 'high' ? 'high' : 'routine' });

export function PatientProblems({ petId, disabled, onDirtyChange }: PatientProblemsProps) {
  const query = usePatientProblems(petId);
  const cache = useQueryClient();
  const { session } = useAuth();
  const [record, setRecord] = useState<Tables<'patient_problems'> | null>(null);
  const [draft, setDraft] = useState<ProblemDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  useEffect(() => { onDirtyChange(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const open = (row: Tables<'patient_problems'> | null) => {
    if (busy || (dirty && !window.confirm('Discard unsaved problem changes?'))) return;
    const next = row ? toDraft(row) : { ...emptyProblem };
    setRecord(row); setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setMessage('');
  };
  const save = async () => {
    if (!draft || busyRef.current || !session?.user.id) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('save_patient_problem', { p_id: record?.id ?? null, p_pet_id: petId, p_expected_version: record?.version ?? null, p_title: draft.title.trim(), p_notes: draft.notes, p_onset_date: draft.onset_date || null, p_status: draft.status, p_importance: draft.importance });
      if (error) throw error;
      if (!data) throw new Error('No saved problem was returned. Reload before retrying.');
      const next = toDraft(data); setRecord(data); setDraft(next); setBaseline(JSON.stringify(next)); setMessage('Problem saved.');
      void cache.invalidateQueries({ queryKey: ['patient-problems', petId] });
    } catch (error) { setError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const reload = async () => {
    if (!record || busyRef.current || !window.confirm('Discard local problem changes and reload the saved problem?')) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.from('patient_problems').select('*').eq('id', record.id).eq('pet_id', petId).single();
      if (error) throw error;
      const next = toDraft(data); setRecord(data); setDraft(next); setBaseline(JSON.stringify(next)); setMessage('Latest saved problem loaded.');
    } catch (error) { setError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-lg">Problems and historical diagnoses</CardTitle><Button variant="outline" disabled={disabled || busy} onClick={() => open(null)}>Add problem</Button></CardHeader><CardContent className="space-y-4">
    {query.isPending && <p role="status">Loading problems…</p>}{query.isError && <p role="alert" className="text-destructive">Could not load problem history. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}{query.data?.length === 0 && <p className="text-sm text-muted-foreground">No problems recorded.</p>}
    <ul className="space-y-2">{query.data?.map(problem => <li key={problem.id} className={`rounded-md border p-3 ${problem.importance === 'high' ? 'border-destructive bg-destructive/10' : ''}`}><div className="flex items-start justify-between gap-3"><div><p className={`font-medium ${problem.importance === 'high' ? 'text-clinical-alert' : ''}`}>{problem.importance === 'high' && <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />}{problem.title}</p><p className="text-xs text-muted-foreground">{problem.status === 'resolved' ? 'Resolved' : 'Active'}{problem.importance === 'high' ? ' · Important history' : ''}{problem.onset_date ? ` · Onset ${problem.onset_date}` : ''}</p></div><Button variant="ghost" size="sm" disabled={busy || disabled} onClick={() => open(problem)}>Edit</Button></div>{problem.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{problem.notes}</p>}</li>)}</ul>
    {draft && <div className="space-y-3 border-t pt-4"><h3 className="font-semibold">{record ? 'Edit problem' : 'New problem'}</h3><p role="status" className="text-sm text-muted-foreground">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : message || (record ? 'Saved record' : 'Not saved yet')}</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{record && <Button variant="outline" size="sm" disabled={busy} onClick={() => void reload()}>Reload latest saved problem</Button>}<fieldset disabled={busy || disabled} className="space-y-3"><legend className="sr-only">Problem details</legend><div className="space-y-2"><Label htmlFor="problem-title">Problem or diagnosis</Label><Input id="problem-title" required maxLength={500} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="problem-notes">Notes</Label><Textarea id="problem-notes" maxLength={10000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></div><div className="grid gap-3 md:grid-cols-3"><div className="space-y-2"><Label htmlFor="problem-onset">Onset date</Label><Input type="date" id="problem-onset" value={draft.onset_date} onChange={event => setDraft({ ...draft, onset_date: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="problem-status">Status</Label><select id="problem-status" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProblemDraft['status'] })}><option value="active">Active</option><option value="resolved">Resolved</option></select></div><div className="space-y-2"><Label htmlFor="problem-importance">History flag</Label><select id="problem-importance" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.importance} onChange={event => setDraft({ ...draft, importance: event.target.value as ProblemDraft['importance'] })}><option value="routine">Routine</option><option value="high">Important — red alert</option></select></div></div></fieldset><div className="flex flex-wrap gap-2"><Button disabled={busy || disabled || !draft.title.trim() || (!!record && !dirty)} onClick={() => void save()}>Save problem</Button><Button variant="outline" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved problem changes?')) { setDraft(null); setError(''); } }}>Close editor</Button></div></div>}
  </CardContent></Card>;
}
