import { useState } from "react";
import { useTemplates } from "@/hub/hooks/use-templates";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Search } from "lucide-react";

interface TemplateSelectorProps { onSelect: (content: string) => void; }

export function TemplateSelector({ onSelect }: TemplateSelectorProps) {
  const { data: templates, isLoading } = useTemplates();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = templates?.filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()) || t.content.toLowerCase().includes(search.toLowerCase())
  );
  const grouped = filtered?.reduce<Record<string, typeof filtered>>((acc, t) => { (acc[t.category] ??= []).push(t); return acc; }, {});

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Insert template"><FileText className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="top">
        <div className="p-2 border-b"><div className="relative"><Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..." className="h-8 pl-7 text-xs" /></div></div>
        <ScrollArea className="max-h-64">
          {isLoading ? <p className="p-3 text-xs text-muted-foreground">Loading...</p> : !grouped || Object.keys(grouped).length === 0 ? <p className="p-3 text-xs text-muted-foreground">No templates found</p> : (
            <div className="p-1">{Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{category}</p>
                {items.map((t) => (<button key={t.id} className="w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors" onClick={() => { onSelect(t.content); setOpen(false); setSearch(""); }}><span className="font-medium">{t.title}</span><p className="text-muted-foreground truncate mt-0.5">{t.content.slice(0, 60)}...</p></button>))}
              </div>
            ))}</div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
