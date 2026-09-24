import type { AnesthesiaRecord } from "./model";
interface AnesthesiaHistorySnapshotProps {
  record: AnesthesiaRecord;
}
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function AnesthesiaHistorySnapshot({
  record,
}: AnesthesiaHistorySnapshotProps) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">
        {record.procedure_name} · {record.status}
      </p>
      <p>
        {when(record.started_at)} to{" "}
        {record.ended_at ? when(record.ended_at) : "end not recorded"} Denver
      </p>
      <p>Team: {record.team}</p>
      <dl className="space-y-2">
        {[
          ["Assessment", record.assessment],
          ["Plan", record.plan],
          ["Recovery", record.recovery_notes],
          [
            "Source",
            record.source === "manual"
              ? "Manually recorded"
              : "Transcribed from original patient document",
          ],
          ["Source detail", record.source_description],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium">{label}</dt>
            <dd className="whitespace-pre-wrap">{value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
      <p>
        Original file{" "}
        {record.original_document_id
          ? "linked in this saved version"
          : "not linked"}
      </p>
      <p className="font-medium">Monitoring observations</p>
      {record.observations.length ? (
        <ul className="space-y-2">
          {record.observations.map((o, index) => (
            <li key={index}>
              {when(o.at)} Denver · {o.label}: {o.value} {o.unit}
              {o.notes && <p className="whitespace-pre-wrap">{o.notes}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p>No observations recorded.</p>
      )}
      <p className="font-medium">Documentary events</p>
      {record.events.length ? (
        <ul className="space-y-2">
          {record.events.map((event, index) => (
            <li key={index}>
              {when(event.at)} Denver · {event.kind}
              <p className="whitespace-pre-wrap">{event.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No events recorded.</p>
      )}
    </div>
  );
}
