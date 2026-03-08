import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MessageSquare, PawPrint, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClients } from "@/hub/hooks/use-clients";
import { useClientMessages } from "@/hub/hooks/use-conversations";
import { ClientNotesCard } from "@/hub/components/clients/ClientNotesCard";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import { formatDistanceToNow } from "date-fns";
import { usePageTitle } from "@/hooks/use-page-title";

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: clients, isLoading } = useClients();
  const { data: recentMessages } = useClientMessages(id);

  const client = clients?.find((c) => c.id === id);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Client not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/hub/clients")}>
          Back to clients
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-3 py-2.5 bg-card sticky top-0 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/hub/clients")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <BrandAvatar name={client.full_name} email={client.primary_email} className="h-8 w-8 text-xs" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{client.full_name}</p>
          <p className="text-xs text-muted-foreground">{client.preferred_channel || "SMS"} preferred</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Contact info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contact Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {client.primary_phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${client.primary_phone}`} className="text-primary hover:underline">
                  {client.primary_phone}
                </a>
              </div>
            )}
            {client.primary_email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${client.primary_email}`} className="text-primary hover:underline">
                  {client.primary_email}
                </a>
              </div>
            )}
            {!client.primary_phone && !client.primary_email && (
              <p className="text-sm text-muted-foreground">No contact info on file</p>
            )}
          </CardContent>
        </Card>

        {/* Pets */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PawPrint className="h-4 w-4" /> Pets ({client.pets.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client.pets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pets on file</p>
            ) : (
              <div className="space-y-3">
                {client.pets.map((pet) => (
                  <div key={pet.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {pet.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{pet.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pet.species}{pet.breed ? ` · ${pet.breed}` : ""}
                        {pet.weight_lbs ? ` · ${pet.weight_lbs} lbs` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <ClientNotesCard clientId={id!} />

        {/* Recent messages */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Recent Messages
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!recentMessages || recentMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet</p>
            ) : (
              <div className="space-y-2">
                {recentMessages.slice(0, 5).map((msg) => (
                  <div key={msg.id} className="rounded-lg bg-muted/50 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant="outline" className="text-[10px] h-4">
                        {msg.sender_type} · {msg.type}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2">{msg.content || "(no text)"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
