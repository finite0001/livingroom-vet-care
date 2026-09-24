import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hub/contexts/auth-context';
import { practiceAddress } from '@/config/practice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { encounterDraft, newEncounter, denverInstant, errorText, type EncounterDraft } from './editor-state';
import { useClinicalEncounters } from './queries';
import { PatientProblems } from './PatientProblems';

interface ClinicalWorkspaceProps { petId: string; disabled?: boolean; onDirtyChange?: (dirty: boolean) => void }
const dateTime = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ClinicalWorkspace({ petId, disabled = false, onDirtyChange }: ClinicalWorkspaceProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const encounters = useClinicalEncounters(petId);
  const [record, setRecord] = useState<Tables<'clinical_encounters'> | null>(null);
  const [draft, setDraft] = useState<EncounterDraft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [addendum, setAddendum] = useState('');
  const [problemDirty, setProblemDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmSign, setConfirmSign] = useState(false);
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const unsaved = dirty || !!addendum.trim() || problemDirty || busy;
  useEffect(() => {
    onDirtyChange?.(unsaved);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, unsaved]);
  const signed = record?.status === 'signed';
  const addenda = useQuery({ queryKey: ['clinical-addenda', record?.id], enabled: !!record, queryFn: async () => {
    const { data, error } = await supabase.from('clinical_addenda').select('*').eq('encounter_id', record!.id).order('created_at');
    if (error) throw error;
    return data;
  } });
  const authors = useQuery({ queryKey: ['clinical-authors'], queryFn: async () => {
    const { data, error } = await supabase.from('profiles').select('id, full_name');
    if (error) throw error;
    return data;
  } });
  const author = (id: string | null) => authors.data?.find(person => person.id === id)?.full_name || (id ? `Staff ${id}` : 'Unknown staff');
  const select = (row: Tables<'clinical_encounters'> | null) => {
    if (busy || ((dirty || addendum.trim()) && !window.confirm('Discard unsaved clinical changes?'))) return;
    const next = row ? encounterDraft(row) : newEncounter();
    setRecord(row); setDraft(next); setBaseline(JSON.stringify(next)); setAddendum(''); setError(''); setMessage('');
  };
  const adopt = (row: Tables<'clinical_encounters'>) => {
    const next = encounterDraft(row);
    setRecord(row); setDraft(next); setBaseline(JSON.stringify(next));
    void cache.invalidateQueries({ queryKey: ['clinical-encounters', petId] });
  };
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    if (!session?.user.id) { setError('Sign in to save clinical records.'); return; }
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (error) { setError(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = () => run(async () => {
    if (!draft) return;
    const { data, error } = await supabase.rpc('save_clinical_encounter', {
      p_id: record?.id ?? null, p_pet_id: petId, p_expected_version: record?.version ?? null,
      p_visit_at: denverInstant(draft.visit_at), p_visit_type: draft.visit_type, p_location: draft.location,
      p_subjective: draft.subjective, p_objective: draft.objective, p_assessment: draft.assessment, p_plan: draft.plan,
    });
    if (error) throw error;
    if (!data) throw new Error('No saved record was returned. Reload before retrying.');
    adopt(data); setMessage('Draft saved.');
  });
  const sign = () => run(async () => {
    if (!record || dirty) throw new Error('Save and review your draft before signing.');
    const { data, error } = await supabase.rpc('sign_clinical_encounter', { p_id: record.id, p_expected_version: record.version });
    if (error) throw error;
    if (!data) throw new Error('No signed record was returned. Reload before retrying.');
    adopt(data); setMessage('Encounter signed. Corrections can be added as an addendum.');
  });
  const append = () => run(async () => {
    if (!record || !addendum.trim()) return;
    const { error } = await supabase.rpc('add_clinical_addendum', { p_encounter_id: record.id, p_content: addendum.trim() });
    if (error) throw error;
    setAddendum(''); setMessage('Addendum saved.');
    void cache.invalidateQueries({ queryKey: ['clinical-addenda', record.id] });
  });
  const reload = () => run(async () => {
    if (!record || !window.confirm('Discard your local changes and load the latest saved encounter?')) return;
    const { data, error } = await supabase.from('clinical_encounters').select('*').eq('id', record.id).eq('pet_id', petId).single();
    if (error) throw error;
    adopt(data); setAddendum(''); setMessage('Latest saved encounter loaded.');
  });
  return <section className="space-y-6" aria-label="Clinical records">
    <PatientProblems petId={petId} disabled={disabled} onDirtyChange={setProblemDirty} />
    <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-lg">Clinical encounters</CardTitle><Button disabled={disabled || busy} onClick={() => select(null)}>New encounter</Button></CardHeader><CardContent className="space-y-4">
      {disabled && <p className="text-sm text-muted-foreground">This patient is inactive. Existing drafts can be corrected; encounter history and signed-record addenda remain available.</p>}
      {encounters.isPending && <p role="status">Loading encounters…</p>}
      {encounters.isError && <p role="alert" className="text-destructive">Could not load encounters. <button className="underline" onClick={() => void encounters.refetch()}>Retry</button></p>}
      {encounters.data?.length === 0 && <p className="text-sm text-muted-foreground">No clinical encounters recorded.</p>}
      <div className="flex flex-wrap gap-2">{encounters.data?.map(row => <Button key={row.id} variant={record?.id === row.id ? 'secondary' : 'outline'} disabled={busy} onClick={() => select(row)}>{dateTime(row.visit_at)} · {row.visit_type} · {row.status}</Button>)}</div>
      {draft && <div className="space-y-4 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{signed ? 'Signed encounter' : record ? 'Edit draft encounter' : 'New encounter'}</h3><p role="status" className="text-sm text-muted-foreground">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : message || (record ? 'Saved record' : 'Not saved yet')}</p></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {record && <Button size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>Reload latest saved record</Button>}
        {record && !signed && <p className="text-sm text-muted-foreground">Created by {author(record.created_by)} · Last updated by {author(record.updated_by)} on {dateTime(record.updated_at)} (America/Denver).</p>}
        {signed && <p className="text-sm">Signed by {author(record.signed_by)} on {record.signed_at ? dateTime(record.signed_at) : 'unknown time'} (America/Denver). Original text is locked.</p>}
        <fieldset disabled={busy || (disabled && !record)} className="space-y-4"><legend className="sr-only">Encounter details</legend><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="visit-date">Visit date and time (America/Denver)</Label><Input readOnly={signed} id="visit-date" type="datetime-local" value={draft.visit_at} onChange={event => setDraft({ ...draft, visit_at: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="visit-type">Visit type</Label><select disabled={signed} id="visit-type" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-100" value={draft.visit_type} onChange={event => { const visit_type = event.target.value as 'clinic' | 'housecall'; setDraft({ ...draft, visit_type, location: visit_type === 'clinic' ? practiceAddress : '' }); }}><option value="clinic">Clinic</option><option value="housecall">Housecall</option></select></div></div>
          <div className="space-y-2"><Label htmlFor="visit-location">Visit location</Label><Input readOnly={signed} id="visit-location" maxLength={1000} value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></div>
          {(['subjective', 'objective', 'assessment', 'plan'] as const).map(field => <div key={field} className="space-y-2"><Label htmlFor={`soap-${field}`} >{field.charAt(0).toUpperCase() + field.slice(1)}</Label><Textarea readOnly={signed} id={`soap-${field}`} rows={5} maxLength={50000} value={draft[field]} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></div>)}
        </fieldset>
        {!signed && <div className="flex flex-wrap gap-2"><Button disabled={busy || (disabled && !record) || (!!record && !dirty)} onClick={() => void save()}>Save draft</Button><Button variant="outline" disabled={busy || dirty || !record} onClick={() => setConfirmSign(true)}>Review and sign</Button><p className="w-full text-xs text-muted-foreground">Save explicitly. Clinical text is not automatically saved.</p></div>}
        {signed && <div className="space-y-3"><h4 className="font-semibold">Addenda</h4>{addenda.isPending && <p role="status">Loading addenda…</p>}{addenda.isError && <p role="alert" className="text-destructive">Could not load addenda. <button className="underline" onClick={() => void addenda.refetch()}>Retry</button></p>}{addenda.data?.map(item => <article key={item.id} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{author(item.created_by)} · {dateTime(item.created_at)} (America/Denver)</p><p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p></article>)}<Label htmlFor="addendum">Append a correction or additional information</Label><Textarea id="addendum" value={addendum} maxLength={50000} disabled={busy} onChange={event => setAddendum(event.target.value)} /><Button disabled={busy || !addendum.trim()} onClick={() => void append()}>Save addendum</Button></div>}
      </div>}
    </CardContent></Card>
    <AlertDialog open={confirmSign} onOpenChange={setConfirmSign}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sign this clinical encounter?</AlertDialogTitle><AlertDialogDescription>The saved SOAP record will be locked and attributed to your account. Review the text before signing. Later corrections must be recorded as addenda.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep reviewing</AlertDialogCancel><AlertDialogAction onClick={() => void sign()}>Sign saved encounter</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
