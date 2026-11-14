import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { readTeam, teamCommand } from "./team-api";
export function useTeam() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["staff-team", session?.user.id],
    queryFn: readTeam,
    enabled: Boolean(session?.user.id),
    refetchInterval: 60000,
  });
  async function perform(action: string, data: unknown, id?: string) {
    setPending(true);
    setError("");
    try {
      await teamCommand(action, data, id);
      await client.invalidateQueries({ queryKey: ["staff-team"] });
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please retry.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }
  return { query, pending, error, perform, userId: session?.user.id };
}
