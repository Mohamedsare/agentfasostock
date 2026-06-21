"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { ActionResult } from "@/lib/actions/conversations";

function revalidate() {
  revalidatePath("/dashboard/knowledge-base");
}

export interface ProductInput {
  agentId: string;
  name: string;
  description?: string;
  price?: number | null;
  currency?: string;
  images?: string[];
  isActive?: boolean;
}

export async function createProduct(input: ProductInput): Promise<ActionResult & { id?: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  if (!input.name?.trim()) return { ok: false, error: "Le nom du produit est requis." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      agent_id: input.agentId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      price: input.price ?? null,
      currency: input.currency ?? "XOF",
      images: input.images ?? [],
      is_active: input.isActive ?? true,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, id: data.id };
}

export async function updateProduct(id: string, input: Omit<ProductInput, "agentId">): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      name: input.name?.trim(),
      description: input.description?.trim() ?? null,
      price: input.price ?? null,
      currency: input.currency ?? "XOF",
      images: input.images ?? [],
      is_active: input.isActive ?? true,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function toggleProduct(id: string, isActive: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteProduct(id: string, images: string[]): Promise<ActionResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "Supabase non configuré." };
  const supabase = await createClient();
  // Remove images from storage (best-effort)
  if (images.length > 0) {
    const paths = images
      .map((url) => {
        try {
          return decodeURIComponent(new URL(url).pathname.split("/product-images/")[1] ?? "");
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("product-images").remove(paths);
    }
  }
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}
