import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, PawPrint } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useClients, type ClientWithPets } from "@/hub/hooks/use-clients";
import { CreateClientSheet } from "@/hub/components/clients/CreateClientSheet";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import { cn } from "@/lib/utils";

export default function ClientsPage() {
  const navigate = useNavigate();
  const { data: clients, isLoading, isError } = useClients();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!clients) return [];
    if (!search.trim()) return clients;
    const s = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.full_name.toLowerCase().includes(s) ||
        c.primary_phone?.includes(s) ||
        c.primary_email?.toLowerCase().includes(s) ||
        c.pets.some((p) => p.name.toLowerCase().includes(s))
    );
  }, [clients, search]);

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
            placeholder="Search name, phone, email, pet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
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

function ClientRow({ client, onClick }: { client: ClientWithPets; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 border-b px-4 py-3 cursor-pointer hover:bg-accent/40 transition-colors"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
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
