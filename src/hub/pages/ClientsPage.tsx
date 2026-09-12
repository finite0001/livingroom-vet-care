import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, PawPrint } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useClients, type ClientWithPets } from "@/hub/hooks/use-clients";
import { CreateClientSheet } from "@/hub/components/clients/CreateClientSheet";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ClientsPage() {
  usePageTitle("Clients");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { data: clients, isLoading, isError } = useClients(debouncedSearch);
  const filtered = clients ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Clients</h1>
          <CreateClientSheet />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search clients"
            maxLength={250}
            placeholder="Search name, phone, email, pet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length >= 250 && <p role="status" className="px-4 py-2 text-sm text-muted-foreground">Showing the first 250 matches. Refine your search to find additional clients.</p>}
        {isLoading ? (
          <div className="space-y-1 p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Users}
            title="Failed to load clients"
            description="Something went wrong. Please try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? "No clients found" : "No clients yet"}
            description={search ? "Try a different search" : "Add your first client to get started"}
          />
        ) : (
          filtered.map((client) => (
            <ClientRow key={client.id} client={client} onClick={() => navigate(`/hub/client/${client.id}`)} />
          ))
        )}
      </div>
    </div>
  );
}

interface ClientRowProps { client: ClientWithPets; onClick: () => void; }

function ClientRow({ client, onClick }: ClientRowProps) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 border-b px-4 py-3 cursor-pointer hover:bg-accent/40 transition-colors"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <BrandAvatar name={client.full_name} email={client.primary_email} className="h-9 w-9 text-sm shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{client.full_name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {client.primary_phone || client.primary_email || "No contact info"}
        </p>
      </div>
      {client.pets.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          <PawPrint className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {client.pets.length === 1 ? client.pets[0].name : `${client.pets.length} pets`}
          </span>
        </div>
      )}
    </div>
  );
}
