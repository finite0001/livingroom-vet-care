import { useMemo, useState } from "react";
import { Upload, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/use-page-title";

interface ParsedRow { first_name: string; last_name: string; phone: string; email: string; pet_name: string; species: string; }

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const fi = idx(["first_name", "first", "firstname"]);
  const li = idx(["last_name", "last", "lastname"]);
  const ni = idx(["full_name", "name", "client_name"]);
  const pi = idx(["phone", "primary_phone", "mobile"]);
  const ei = idx(["email", "primary_email"]);
  const peti = idx(["pet_name", "pet", "patient"]);
  const si = idx(["species", "pet_species"]);
  const cell = (c: string[], i: number) => (i >= 0 ? (c[i] ?? "").trim() : "");
  return lines.slice(1).map((line) => {
    const c = parseLine(line);
    let first = cell(c, fi), last = cell(c, li);
    if (!first && !last && ni >= 0) {
      const full = cell(c, ni).split(/\s+/);
      first = full[0] ?? ""; last = full.slice(1).join(" ");
    }
    return { first_name: first, last_name: last, phone: cell(c, pi), email: cell(c, ei), pet_name: cell(c, peti), species: cell(c, si) };
  }).filter((r) => r.first_name || r.last_name);
}

export default function ImportPage() {
  usePageTitle("Import Clients");
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ clients: number; pets: number } | null>(null);

  const rows = useMemo(() => parseCsv(text), [text]);

  const handleImport = async () => {
    if (rows.length === 0) { toast.error("No valid rows to import"); return; }
    setImporting(true);
    setResult(null);
    try {
      const clientRows = rows.map((r) => ({
        first_name: r.first_name || "",
        last_name: r.last_name || "",
        full_name: `${r.first_name} ${r.last_name}`.trim(),
        primary_phone: r.phone || null,
        primary_email: r.email || null,
        preferred_channel: "SMS" as const,
      }));
      const { data: inserted, error } = await supabase.from("clients").insert(clientRows).select("id");
      if (error) throw error;

      // Link pets to clients positionally: a single multi-row INSERT returns its
      // RETURNING rows in VALUES order, so inserted[i] corresponds to rows[i].
      // Keep this a single batch insert — don't switch to per-row/upsert or the
      // index correlation breaks and pets could attach to the wrong client.
      const petRows: { client_id: string; name: string; species: string }[] = [];
      rows.forEach((r, i) => {
        const client = inserted?.[i];
        if (r.pet_name && client) petRows.push({ client_id: client.id, name: r.pet_name, species: r.species || "Unknown" });
      });
      if (petRows.length) {
        const { error: petErr } = await supabase.from("pets").insert(petRows);
        if (petErr) throw petErr;
      }

      setResult({ clients: inserted?.length ?? 0, pets: petRows.length });
      setText("");
      toast.success(`Imported ${inserted?.length ?? 0} clients`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Import Clients &amp; Pets</h1>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Paste CSV</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              First row is the header. Recognized columns: <span className="font-mono">first_name, last_name</span> (or <span className="font-mono">full_name</span>), <span className="font-mono">phone</span>, <span className="font-mono">email</span>, <span className="font-mono">pet_name</span>, <span className="font-mono">species</span>.
            </p>
            <Textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setResult(null); }}
              rows={6}
              className="font-mono text-xs"
              placeholder={"first_name,last_name,phone,email,pet_name,species\nJane,Doe,+15551234567,jane@example.com,Rex,Dog"}
            />
            {result && (
              <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700">
                <Check className="h-4 w-4" /> Imported {result.clients} client{result.clients === 1 ? "" : "s"} and {result.pets} pet{result.pets === 1 ? "" : "s"}.
              </div>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Preview ({rows.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Pet</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 100).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{`${r.first_name} ${r.last_name}`.trim() || <span className="text-destructive">missing</span>}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.phone || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.email || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{r.pet_name ? `${r.pet_name}${r.species ? ` (${r.species})` : ""}` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 100 && <p className="px-4 py-2 text-xs text-muted-foreground">Showing first 100 of {rows.length}; all will be imported.</p>}
            </CardContent>
          </Card>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Import does not de-duplicate against existing clients. Review the preview before importing.</span>
        </div>

        <Button className="w-full" disabled={importing || rows.length === 0} onClick={handleImport}>
          {importing ? "Importing…" : `Import ${rows.length} client${rows.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
