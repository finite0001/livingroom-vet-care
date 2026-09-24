import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, PawPrint } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/use-page-title";
import { EmptyState } from "@/hub/components/shared/EmptyState";

interface PatientRow {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  client_id: string;
  archived_at: string | null;
  deceased_at: string | null;
  clients: { full_name: string } | null;
}

const SPECIES = ["Dog", "Cat", "Other"];

export default function PatientsPage() {
  usePageTitle("Patients");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [species, setSpecies] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const patients = useQuery({
    queryKey: ["patients-list", debounced, species, status],
    queryFn: async (): Promise<PatientRow[]> => {
      let query = supabase
        .from("pets")
        .select(
          "id, name, species, breed, sex, client_id, archived_at, deceased_at, clients(full_name)",
        )
        .order("name")
        .limit(250);
      if (debounced) query = query.ilike("name", `%${debounced.replace(/[\\%_]/g, "\\$&")}%`);
      if (species) query = query.eq("species", species);
      if (status === "active") query = query.is("archived_at", null).is("deceased_at", null);
      if (status === "inactive") query = query.or("archived_at.not.is.null,deceased_at.not.is.null");
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as PatientRow[];
    },
  });

  const rows = patients.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Patients</h1>
        <p className="text-sm text-muted-foreground mt-1">All patients across households.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search patients"
            maxLength={100}
            placeholder="Search patient name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <select
          aria-label="Species filter"
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All species</option>
          {SPECIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Patient status filter"
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | "active" | "inactive")}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">All patients</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {rows.length >= 250 && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the first 250 matches. Refine your search to find additional patients.
        </p>
      )}

      {patients.isLoading ? (
        <div className="space-y-1">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : patients.isError ? (
        <EmptyState
          icon={PawPrint}
          title="Failed to load patients"
          description="Something went wrong. Please try again."
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={PawPrint} title="No patients found" description="No patients match your filters." />
      ) : (
        <ul className="space-y-1">
          {rows.map((pet) => {
            const inactive = !!(pet.archived_at || pet.deceased_at);
            return (
              <li key={pet.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-between gap-2 rounded-lg px-3 py-2 text-left"
                  onClick={() => navigate(`/hub/patient/${pet.id}`)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <span className="font-medium">{pet.name}</span>
                      {inactive && (
                        <Badge variant="secondary" className="ml-2 align-middle">Inactive</Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {pet.species}
                      {pet.breed ? ` · ${pet.breed}` : ""} · {pet.clients?.full_name ?? "Household unavailable"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{pet.sex}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
