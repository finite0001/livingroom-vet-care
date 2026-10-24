import { createContext, useContext } from "react";
import type { ReviewStaffSessionSource } from "./staff-session.ts";

export const ReviewStaffSessionContext = createContext<ReviewStaffSessionSource | null>(null);
export function useReviewStaffSessions(): ReviewStaffSessionSource {
  const source = useContext(ReviewStaffSessionContext);
  if (!source) throw new Error("Review staff sessions require the application Auth provider");
  return source;
}
