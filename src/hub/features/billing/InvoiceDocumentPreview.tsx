import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { practice, practiceAddress } from "@/config/practice";
import { renderInvoiceDocument } from "./invoice-document";

interface InvoiceDocumentPreviewProps {
  invoiceId: string;
  clientId: string;
  disabled: boolean;
}
export function InvoiceDocumentPreview({
  invoiceId,
  clientId,
  disabled,
}: InvoiceDocumentPreviewProps) {
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setOpen(true);
    setBusy(true);
    setHtml("");
    setError("");
    try {
      const { data, error } = await supabase.rpc("read_invoice_document", {
        p_invoice_id: invoiceId,
        p_client_id: clientId,
      });
      if (error) throw error;
      setHtml(
        renderInvoiceDocument(data, {
          name: practice.name,
          address: practiceAddress,
          domain: practice.domain,
        }),
      );
    } catch {
      setError(
        "Invoice document could not be loaded. Retry to read the current invoice.",
      );
    } finally {
      setBusy(false);
    }
  }
  function print() {
    const popup = window.open("", "_blank");
    if (!popup) {
      setError(
        "The print window was blocked. Allow popups for this site or download the HTML copy.",
      );
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `living-room-invoice-${invoiceId}.html`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void load()}
      >
        Preview invoice document
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>Invoice document</DialogTitle>
            <DialogDescription>
              Review this copy before printing or downloading. Use your
              browser’s print dialog to save a PDF.
            </DialogDescription>
          </DialogHeader>
          {busy && <p role="status">Loading current invoice…</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh invoice document
            </Button>
            <Button disabled={!html || busy} onClick={print}>
              Print / save PDF
            </Button>
            <Button
              variant="outline"
              disabled={!html || busy}
              onClick={download}
            >
              Download HTML copy
            </Button>
          </div>
          {html && (
            <iframe
              title="Invoice document preview"
              sandbox=""
              srcDoc={html}
              className="min-h-0 w-full flex-1 border bg-background"
              style={{ height: "60dvh", flexBasis: "60dvh" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
