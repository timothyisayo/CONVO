import type { SupabaseClient } from "@supabase/supabase-js";

export const MARKETPLACE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MARKETPLACE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type MarketplaceCategory = "books" | "electronics" | "supplies" | "services" | "other";
export type MarketplaceCondition = "new" | "like_new" | "good" | "fair" | "service";
export type MarketplaceListing = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  category: MarketplaceCategory;
  item_condition: MarketplaceCondition;
  price: number;
  currency: "NGN";
  image_path: string | null;
  status: "active" | "sold" | "hidden";
  created_at: string;
  updated_at: string;
  image_url?: string | null;
};
export type MarketplaceListingDraft = {
  title: string;
  description: string;
  category: MarketplaceCategory;
  condition: MarketplaceCondition;
  price: string;
  currency: "NGN";
  image: File | null;
};

const isMarketplaceCategory = (value: string): value is MarketplaceCategory =>
  ["books", "electronics", "supplies", "services", "other"].includes(value);
const isMarketplaceCondition = (value: string): value is MarketplaceCondition =>
  ["new", "like_new", "good", "fair", "service"].includes(value);

export function validateMarketplaceListingDraft(draft: MarketplaceListingDraft) {
  const title = draft.title.trim();
  const description = draft.description.trim();
  const price = Number(draft.price);
  if (!title || title.length > 120) return { valid: false as const, error: "Titles must contain 1 to 120 characters." };
  if (description.length > 3000) return { valid: false as const, error: "Descriptions must be 3,000 characters or fewer." };
  if (!draft.price.trim() || !Number.isFinite(price) || price < 0 || price > 9999999999.99) return { valid: false as const, error: "Enter a valid non-negative price." };
  if (!isMarketplaceCategory(draft.category) || !isMarketplaceCondition(draft.condition)) return { valid: false as const, error: "Choose a valid category and condition." };
  if (draft.currency !== "NGN") return { valid: false as const, error: "Marketplace prices must be listed in NGN." };
  if (draft.image && !MARKETPLACE_IMAGE_TYPES.includes(draft.image.type as (typeof MARKETPLACE_IMAGE_TYPES)[number])) return { valid: false as const, error: "Use a JPG, PNG, or WebP listing photo." };
  if (draft.image && draft.image.size > MARKETPLACE_IMAGE_MAX_BYTES) return { valid: false as const, error: "Listing photos must be 8 MB or smaller." };
  return { valid: true as const, value: { title, description, price } };
}

export async function loadMarketplaceListings(client: SupabaseClient, query: string, category: MarketplaceCategory | "all") {
  const { data, error } = await client.rpc("search_mtu_marketplace_listings", {
    p_query: query.trim(),
    p_category: category,
  });
  if (error) return { data: [] as MarketplaceListing[], error };
  const listings = (data || []) as MarketplaceListing[];
  const signed = await Promise.all(listings.map(async (listing) => {
    if (!listing.image_path) return { ...listing, image_url: null };
    const result = await client.storage.from("marketplace-media").createSignedUrl(listing.image_path, 60 * 60);
    if (result.error) throw new Error(`Could not load listing photo: ${result.error.message}`);
    return { ...listing, image_url: result.data.signedUrl };
  }));
  return { data: signed, error: null };
}

export async function saveMarketplaceListing(
  client: SupabaseClient,
  userId: string,
  draft: MarketplaceListingDraft,
  existing?: MarketplaceListing,
) {
  const validation = validateMarketplaceListingDraft(draft);
  if (!validation.valid) return { data: null, error: new Error(validation.error) };

  let imagePath = existing?.image_path || null;
  let uploadedPath: string | null = null;
  if (draft.image) {
    const extension = draft.image.type === "image/jpeg" ? "jpg" : draft.image.type.split("/")[1];
    uploadedPath = `${userId}/${crypto.randomUUID()}.${extension}`;
    const upload = await client.storage.from("marketplace-media").upload(uploadedPath, draft.image, {
      upsert: false,
      contentType: draft.image.type,
      cacheControl: "3600",
    });
    if (upload.error) return { data: null, error: upload.error };
    imagePath = uploadedPath;
  }

  const values = {
    title: validation.value.title,
    description: validation.value.description,
    category: draft.category,
    item_condition: draft.condition,
    price: validation.value.price,
    currency: draft.currency,
    image_path: imagePath,
  };
  if (!existing) {
    const result = await client.rpc("create_mtu_marketplace_listing", {
      p_title: values.title,
      p_description: values.description,
      p_category: values.category,
      p_condition: values.item_condition,
      p_price: values.price,
      p_image_path: values.image_path,
    });
    if (result.error || !result.data) {
      if (uploadedPath) {
        const cleanup = await client.storage.from("marketplace-media").remove([uploadedPath]);
        if (cleanup.error) return { data: null, error: new Error(`${result.error?.message || "Listing save failed."} Photo cleanup also failed: ${cleanup.error.message}`) };
      }
      return { data: null, error: result.error || new Error("The listing could not be created.") };
    }
    return { data: result.data as MarketplaceListing, error: null };
  }

  const result = await client.from("marketplace_listings")
    .update(values)
    .eq("id", existing.id)
    .eq("seller_id", userId)
    .select()
    .maybeSingle();

  if (result.error || !result.data) {
    if (uploadedPath) {
      const cleanup = await client.storage.from("marketplace-media").remove([uploadedPath]);
      if (cleanup.error) return { data: null, error: new Error(`${result.error?.message || "Listing save failed."} Photo cleanup also failed: ${cleanup.error.message}`) };
    }
    return { data: null, error: result.error || new Error("You may only edit your own listing.") };
  }

  if (uploadedPath && existing?.image_path) {
    const cleanup = await client.storage.from("marketplace-media").remove([existing.image_path]);
    if (cleanup.error) return { data: result.data as MarketplaceListing, error: new Error(`Listing saved, but its previous photo could not be removed: ${cleanup.error.message}`) };
  }
  return { data: result.data as MarketplaceListing, error: null };
}

export async function setMarketplaceListingStatus(client: SupabaseClient, userId: string, listingId: string, status: MarketplaceListing["status"]) {
  const { data, error } = await client.from("marketplace_listings").update({ status }).eq("id", listingId).eq("seller_id", userId).select("id").maybeSingle();
  return { ok: Boolean(data) && !error, error };
}

export async function deleteMarketplaceListing(client: SupabaseClient, userId: string, listing: MarketplaceListing) {
  const removed = await client.from("marketplace_listings").delete().eq("id", listing.id).eq("seller_id", userId).select("id").maybeSingle();
  if (removed.error || !removed.data) return { ok: false, error: removed.error || new Error("You may only delete your own listing.") };
  if (listing.image_path) {
    const image = await client.storage.from("marketplace-media").remove([listing.image_path]);
    if (image.error) return { ok: true, error: image.error };
  }
  return { ok: true, error: null };
}
