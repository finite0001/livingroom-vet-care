import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSmartReplies } from "@/hub/hooks/use-smart-replies";
import { useEffect } from "react";

interface SmartReplySuggestionsProps { conversationId: string | undefined; onSelect: (text: string) => void; }

export function SmartReplySuggestions({ conversationId, onSelect }: SmartReplySuggestionsProps) {
  const { suggestions, loading, fetchSuggestions } = useSmartReplies(conversationId);
  useEffect(() => { if (conversationId) fetchSuggestions(); }, [conversationId]);
  if (!conversationId) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-t bg-muted/30 overflow-x-auto">
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={fetchSuggestions} disabled={loading} aria-label="Refresh suggestions">
        {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-muted-foreground" />}
      </Button>
      {suggestions.map((s, i) => (<button key={i} className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent transition-colors max-w-[200px] truncate" onClick={() => onSelect(s)} title={s}>{s}</button>))}
      {!loading && suggestions.length === 0 && <span className="text-xs text-muted-foreground">Click to generate suggestions</span>}
    </div>
  );
}
