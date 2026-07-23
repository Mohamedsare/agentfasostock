"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentOrgId } from "@/lib/agents";
import type { ActionResult } from "@/lib/actions/conversations";
import { type EFactDocument, computeTotals } from "@/components/e-fact/types";

/** Archive (or update) a generated document under the current organisation. */
export async function saveEfactDocument(
  doc: EFactDocument,
): Promise<ActionResult & { id?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  if (!doc.number?.trim()) return { ok: false, error: "Numéro du document manquant." };

  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "Organisation introuvable." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A receipt's headline figure is the amount actually received; invoices/quotes
  // use the computed total.
  const total =
    doc.kind === "recu"
      ? Number.isFinite(doc.amountReceived)
        ? doc.amountReceived
        : 0
      : computeTotals(doc).total;

  const { data, error } = await supabase
    .from("efact_documents")
    .upsert(
      {
        org_id: orgId,
        created_by: user?.id ?? null,
        kind: doc.kind,
        number: doc.number.trim(),
        client_name: doc.client.company || doc.client.name || null,
        currency: doc.currency,
        total,
        issue_date: doc.issueDate || null,
        status: doc.kind === "recu" ? doc.paymentStatus : null,
        payload: doc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,number" },
    )
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/e-fact/historique");
  return { ok: true, id: data.id };
}

export async function deleteEfactDocument(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("efact_documents").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/e-fact/historique");
  return { ok: true };
}

/** Fetch the full document JSON for reopening / re-exporting a past document. */
export async function getEfactDocumentPayload(
  id: string,
): Promise<EFactDocument | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("efact_documents")
    .select("payload")
    .eq("id", id)
    .maybeSingle();
  return (data?.payload as EFactDocument | undefined) ?? null;
}
