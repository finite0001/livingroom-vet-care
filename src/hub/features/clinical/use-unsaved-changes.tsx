import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';

export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return <AlertDialog open={blocker.state === 'blocked'}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle><AlertDialogDescription>Unsaved changes across this patient’s clinical, QOL, body map and dental charts will be lost. Save it before leaving if you want to keep it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.state === 'blocked' && blocker.reset()}>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => blocker.state === 'blocked' && blocker.proceed()}>Discard and leave</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
