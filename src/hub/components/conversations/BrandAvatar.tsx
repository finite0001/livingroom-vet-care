import { useState, useEffect, useRef, useCallback } from "react";
import { getFaviconCandidates, getCachedFavicon, setCachedFavicon, markFaviconFailed, isFaviconFailed, FAVICON_MIN_SIZE } from "@/hub/lib/favicon";
import { getAvatarColor, getInitial } from "@/hub/lib/avatar-colors";
import { cn } from "@/lib/utils";

interface BrandAvatarProps {
  email: string | null | undefined;
  name: string;
  className?: string;
  imgClassName?: string;
}

export function BrandAvatar({ email, name, className, imgClassName = "h-5 w-5 object-contain" }: BrandAvatarProps) {
  const cached = getCachedFavicon(email);
  const candidates = getFaviconCandidates(email);
  const firstViable = (startIdx: number) => candidates.findIndex((url, i) => i >= startIdx && !isFaviconFailed(url));

  const [candidateIdx, setCandidateIdx] = useState<number>(() => {
    if (cached === null) return -1;
    if (cached !== undefined) { const idx = candidates.indexOf(cached); return idx >= 0 ? idx : -1; }
    return firstViable(0);
  });

  const candidateIdxRef = useRef(candidateIdx);
  candidateIdxRef.current = candidateIdx;

  useEffect(() => {
    const c = getCachedFavicon(email);
    if (c === null) { setCandidateIdx(-1); return; }
    if (c !== undefined) { const idx = candidates.indexOf(c); setCandidateIdx(idx >= 0 ? idx : -1); return; }
    setCandidateIdx(firstViable(0));
  }, [email]);

  const currentUrl = candidateIdx >= 0 ? candidates[candidateIdx] : null;

  const handleError = useCallback(() => {
    const idx = candidateIdxRef.current;
    const url = idx >= 0 ? candidates[idx] : null;
    if (url) markFaviconFailed(url);
    const next = firstViable(idx + 1);
    if (next >= 0) { setCandidateIdx(next); } else { setCandidateIdx(-1); setCachedFavicon(email, null); }
  }, [candidates, email]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const idx = candidateIdxRef.current;
    const url = idx >= 0 ? candidates[idx] : null;
    const img = e.currentTarget;
    const isGoogle = url?.includes("gstatic.com/faviconV2") || url?.includes("google.com/s2/favicons");
    const minSize = isGoogle ? 24 : FAVICON_MIN_SIZE;
    if (img.naturalWidth < minSize || img.naturalHeight < minSize) { handleError(); return; }
    if (url) setCachedFavicon(email, url);
  }, [candidates, email, handleError]);

  return (
    <div className={cn("flex items-center justify-center rounded-full overflow-hidden", getAvatarColor(name), className)}>
      {currentUrl ? (
        <img src={currentUrl} alt="" className={imgClassName} referrerPolicy="no-referrer" onError={handleError} onLoad={handleLoad} />
      ) : (
        <span>{getInitial(name.split(" ")[0] || name)}</span>
      )}
    </div>
  );
}
