import { createContext, useContext, useEffect } from "react";
export const CareDirtyContext = createContext<
  (id: string, dirty: boolean) => void
>(() => undefined);
export function useCareDirty(id: string, dirty: boolean) {
  const report = useContext(CareDirtyContext);
  useEffect(() => {
    report(id, dirty);
    return () => report(id, false);
  }, [id, dirty, report]);
}
