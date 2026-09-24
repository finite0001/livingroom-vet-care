import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "lrv:guided-mode";

interface GuidedModeContextValue {
  /** Step-by-step view with extra guidance (Direction C content). */
  guided: boolean;
  setGuided: (value: boolean) => void;
}

const GuidedModeContext = createContext<GuidedModeContextValue | null>(null);

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Per-user Guided mode preference. Persisted to localStorage (default off)
 * and mirrored onto `document.documentElement` as the `guided` class so CSS
 * can adjust (see .guided-only / .guided-touch in src/index.css).
 */
export function GuidedModeProvider({ children }: { children: ReactNode }) {
  const [guided, setGuidedState] = useState(readStoredPreference);

  useEffect(() => {
    document.documentElement.classList.toggle("guided", guided);
    try {
      localStorage.setItem(STORAGE_KEY, guided ? "on" : "off");
    } catch {
      // Private browsing or storage-denied: the in-memory value still works.
    }
  }, [guided]);

  const setGuided = useCallback((value: boolean) => setGuidedState(value), []);

  return (
    <GuidedModeContext.Provider value={{ guided, setGuided }}>
      {children}
    </GuidedModeContext.Provider>
  );
}

export function useGuidedMode(): GuidedModeContextValue {
  const value = useContext(GuidedModeContext);
  if (!value) throw new Error("useGuidedMode must be used within GuidedModeProvider");
  return value;
}

const GUIDED_TOOLTIP =
  "Step-by-step view with extra guidance — great for new team members";

/** Header switch that turns Guided mode on/off. */
export function GuidedModeToggle() {
  const { guided, setGuided } = useGuidedMode();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-1">
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            Guided
          </span>
          <Switch
            checked={guided}
            onCheckedChange={setGuided}
            aria-label="Guided mode"
          />
        </label>
      </TooltipTrigger>
      <TooltipContent side="bottom">{GUIDED_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}
