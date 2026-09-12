"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { previewSource, syncProductSource, validateSourceUrl, type NormalizedProduct, type SyncResult } from "@/lib/product-sync";
import type { ActionResult } from "@/lib/actions/conversations";
import type { ProductSource } from "@/lib/types";

function revalidate() {
  revalidatePath("/dashboard/knowledge-base");
}

const mappingSchema = z
  .object({
    items: z.string(), id: z.string(), name: z.string(), description: z.string(), price: z.string(),
    currency: z.string(), images: z.string(), sku: z.string(), category: z.string(), brand: z.string(),
    stock: z.string(), in_stock: z.string(), url: z.string(),
  })
  .partial();

const sourceSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1, "Le nom est requis.").max(100),
  baseUrl: z.string().trim().url("URL invalide."),
  authType: z.enum(["none", "bearer", "header", "query"]),
  authKeyName: z.string().trim().max(100).optional(),
  /** Empty string = keep the stored key; null = remove it. */
  apiKey: z.string().max(2000).nullable().optional(),
  defaultQuery: z.string().trim().max(500).optional(),
  perPage: z.number().int().min(1).max(200),
  syncIntervalMinutes: z.number().int().min(15).max(10080),
  fieldMapping: mappingSchema,
  isActive: z.boolean(),
});

export type ProductSourceInput = z.infer<typeof sourceSchema>;

function cleanMapping(m: z.infer<typeof mappingSchema>) {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]));
}

function firstIssue(err: z.ZodError) {
  return err.issues[0]?.message ?? "Données invalides.";
}

export async function saveProductSource(
  id: string | null,
  input: ProductSourceInput,
): Promise<ActionResult & { id?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const invalid = validateSourceUrl(v.baseUrl);
  if (invalid) return { ok: false, error: invalid };

  const row: Record<string, unknown> = {
    agent_id: v.agentId,
    name: v.name,
    base_url: v.baseUrl,
    auth_type: v.authType,
    auth_key_name: v.authKeyName || null,
    default_query: v.defaultQuery || null,
    per_page: v.perPage,
    sync_interval_minutes: v.syncIntervalMinutes,
    field_mapping: cleanMapping(v.fieldMapping),
    is_active: v.isActive,
  };
  if (v.authType === "none" || v.apiKey === null) row.api_key_encrypted = null;
  else if (v.apiKey) row.api_key_encrypted = encryptSecret(v.apiKey);

  // RLS on product_sources guarantees the agent belongs to the caller's org.
  const supabase = await createClient();
  const query = id
    ? supabase.from("product_sources").update(row).eq("id", id).select("id").single()
    : supabase.from("product_sources").insert(row).select("id").single();
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id: data.id };
}

export async function deleteProductSource(id: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  // Synced products cascade via products.source_id.
  const { error } = await supabase.from("product_sources").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Test the connection with the form values (before or after saving). */
export async function testProductSource(
  id: string | null,
  input: ProductSourceInput,
): Promise<ActionResult & { total?: number; samples?: NormalizedProduct[]; rawKeys?: string[] }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;

  let apiKey = v.authType === "none" ? null : v.apiKey || null;
  if (!apiKey && id && v.authType !== "none" && v.apiKey !== null) {
    const supabase = await createClient();
    const { data } = await supabase.from("product_sources").select("api_key_encrypted").eq("id", id).single();
    apiKey = decryptSecret((data as Pick<ProductSource, "api_key_encrypted"> | null)?.api_key_encrypted);
  }

  try {
    const preview = await previewSource(
      {
        base_url: v.baseUrl,
        auth_type: v.authType,
        auth_key_name: v.authKeyName || null,
        default_query: v.defaultQuery || null,
        per_page: v.perPage,
        field_mapping: cleanMapping(v.fieldMapping),
      },
      apiKey,
    );
    return { ok: true, ...preview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Échec du test." };
  }
}

export async function runProductSourceSync(
  id: string,
  mode: "full" | "incremental" = "full",
): Promise<ActionResult & { result?: SyncResult }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  // Ownership check through RLS before running the service-role sync.
  const supabase = await createClient();
  const { data } = await supabase.from("product_sources").select("id").eq("id", id).maybeSingle();
  if (!data) return { ok: false, error: "Source introuvable." };

  const result = await syncProductSource(id, { mode });
  revalidate();
  return result.ok ? { ok: true, result } : { ok: false, error: result.error, result };
}
