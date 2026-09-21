import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface ClientHit {
  id: string;
  full_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_clients", {
        p_search: term,
        p_limit: 8,
      });
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setResults([]);
        return;
      }
      setResults((data ?? []) as ClientHit[]);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Search clients and patients"
      >
        <Search className="h-4 w-4" />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search clients and patients…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {loading ? "Searching…" : "No matching clients or patients."}
          </CommandEmpty>
          <CommandGroup heading="Clients">
            {results.map((client) => (
              <CommandItem
                key={client.id}
                value={client.full_name}
                onSelect={() => {
                  setOpen(false);
                  setQuery("");
                  navigate(`/hub/client/${client.id}`);
                }}
              >
                <User className="mr-2 h-4 w-4" />
                <span className="flex-1 truncate">{client.full_name}</span>
                {(client.primary_email || client.primary_phone) && (
                  <span className="text-xs text-muted-foreground truncate max-w-[40%]">
                    {client.primary_email ?? client.primary_phone}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
