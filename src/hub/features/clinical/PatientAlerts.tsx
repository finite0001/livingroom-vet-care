import { AlertTriangle } from 'lucide-react';
import { usePatientProblems } from './queries';

interface PatientAlertsProps { petId: string }
export function PatientAlerts({ petId }: PatientAlertsProps) {
  const query = usePatientProblems(petId);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading patient alerts…</p>;
  if (query.isError) return <div role="alert" className="text-destructive text-sm">Patient alerts could not be loaded. <button className="underline" onClick={() => void query.refetch()}>Retry</button></div>;
  const alerts = query.data.filter(problem => problem.importance === 'high');
  if (!alerts.length) return null;
  return <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-clinical-alert" aria-label="Important patient history"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Important patient history</p><ul className="mt-2 list-disc pl-5 text-sm">{alerts.map(problem => <li key={problem.id}>{problem.title}{problem.status === 'resolved' ? ' (resolved)' : ''}</li>)}</ul></div>;
}
