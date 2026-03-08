import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useSmartReplies(conversationId: string | undefined) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-replies", {
        body: { conversation_id: conversationId },
      });
      if (error) throw error;
      setSuggestions(data?.suggestions ?? []);
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  return { suggestions, loading, fetchSuggestions, setSuggestions };
}
