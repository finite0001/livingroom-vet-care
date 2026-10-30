import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { CountStatementForm } from "../../src/hub/features/controlled-drugs/count/CountStatementForm";
import { CountRecord } from "../../src/hub/features/controlled-drugs/count/CountRecord";
import { id, identity, syntheticCount, syntheticComparedCount } from "./count-entry-fixture";

export function Fixture() {
  const [generation, setGeneration] = useState(0), [calls, setCalls] = useState(0), [saved, setSaved] = useState("");
  const [actor, setActor] = useState(id(1));
  const [data, setData] = useState(syntheticCount);
  const comparison = new URLSearchParams(location.search).has("comparison");
  useEffect(() => { if (comparison) void syntheticComparedCount().then(setData); }, [comparison]);
  return <main className="mx-auto min-w-0 max-w-3xl space-y-4 p-4">
    <p>Synthetic browser fixture. No backend or physical observation.</p>
    <CountRecord data={data} refreshing={false} onRefresh={() => {}} />
    {!comparison && <>
    <button type="button" onClick={() => { setActor(id(2)); setGeneration(value => value + 1); }}>Switch observer</button>
    <CountStatementForm identity={{ ...identity, actor_id: actor, operation_id: id(40 + generation) }} data={syntheticCount()} busy={false} pendingRecovery={false} onSubmit={async request => {
      setCalls(value => value + 1); setSaved(JSON.stringify(request));
      if (new URLSearchParams(location.search).has("unknown")) throw new Error("Synthetic lost response");
    }} /></>}
    <output aria-label="Synthetic save calls">{calls}</output><pre aria-label="Synthetic saved request" className="whitespace-pre-wrap break-all">{saved}</pre>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
