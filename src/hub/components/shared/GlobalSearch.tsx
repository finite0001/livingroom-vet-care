import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PawPrint, Search, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { householdHref, patientHref } from "@/hub/features/patient-360/model";

interface ClientHit {
  id: string;
  full_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}

interface PetHit {
  id: string;
  name: string;
  species: string | null;
  archived_at: string | null;
  deceased_at: string | null;
  clients: { full_name: string | null } | null;
}

interface SearchResults {
  clients: ClientHit[];
  pets: PetHit[];
}

const EMPTY: SearchResults = { clients: [], pets: [] };

/** Escape ILIKE wildcards so a search for "50%" matches literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
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
      setResults(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      // search_clients also matches households by pet name but returns only
      // the household, so matching pets are read separately and shown (and
      // linked) as patients in their own group.
      const [clients, pets] = await Promise.all([
        supabase.rpc("search_clients", { p_search: term, p_limit: 8 }),
        term.length > 100
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from("pets")
              .select("id,name,species,archived_at,deceased_at,clients(full_name)")
              .ilike("name", likePattern(term))
              .order("name")
              .limit(8),
      ]);
      if (cancelled) return;
      setLoading(false);
      setResults({
        clients: clients.error ? [] : ((clients.data ?? []) as ClientHit[]),
        pets: pets.error ? [] : ((pets.data ?? []) as unknown as PetHit[]),
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Search clients and patients"
      >
        <Search className="h-4 w-4" />
      </button>
      {/* Results are already filtered server-side; cmdk's own filter would hide
          households that matched by pet name, phone or email. */}
      <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
        <CommandInput
          placeholder="Search clients and patients…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {loading ? "Searching…" : "No matching clients or patients."}
          </CommandEmpty>
          {results.pets.length > 0 && (
            <CommandGroup heading="Patients">
              {results.pets.map((pet) => (
                <CommandItem
                  key={pet.id}
                  value={`patient-${pet.id}`}
                  onSelect={() => go(patientHref(pet.id))}
                >
                  <PawPrint className="mr-2 h-4 w-4" />
                  <span className="flex-1 truncate">
                    {pet.name}
                    {(pet.archived_at || pet.deceased_at) && (
                      <span className="text-muted-foreground">
                        {pet.deceased_at ? " · deceased" : " · archived"}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground truncate max-w-[50%]">
                    {[pet.species, pet.clients?.full_name].filter(Boolean).join(" · ")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.clients.length > 0 && (
            <CommandGroup heading="Clients">
              {results.clients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`client-${client.id}`}
                  onSelect={() => go(householdHref(client.id))}
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
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
