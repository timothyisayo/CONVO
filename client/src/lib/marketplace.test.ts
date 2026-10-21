import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveMarketplaceListing, validateMarketplaceListingDraft, type MarketplaceListingDraft } from "./marketplace";

const validDraft: MarketplaceListingDraft = {
  title: "  Calculus book  ",
  description: "Used for one semester.",
  category: "books",
  condition: "good",
  price: "1200",
  currency: "NGN",
  image: null,
};

describe("Marketplace listing validation", () => {
  it("trims valid listing text and parses a non-negative price", () => {
    expect(validateMarketplaceListingDraft(validDraft)).toEqual({
      valid: true,
      value: { title: "Calculus book", description: "Used for one semester.", price: 1200 },
    });
  });

  it("rejects blank titles and malformed prices", () => {
    expect(validateMarketplaceListingDraft({ ...validDraft, title: "   " }).valid).toBe(false);
    expect(validateMarketplaceListingDraft({ ...validDraft, price: "not a price" }).valid).toBe(false);
  });

  it("rejects negative prices and unsupported listing photos", () => {
    expect(validateMarketplaceListingDraft({ ...validDraft, price: "-1" }).valid).toBe(false);
    expect(validateMarketplaceListingDraft({
      ...validDraft,
      image: new File([], "sticker.gif", { type: "image/gif" }),
    }).valid).toBe(false);
  });

  it("rejects legacy USD and Housing values instead of silently accepting them", () => {
    const legacyCurrencyDraft = JSON.parse(JSON.stringify({ ...validDraft, currency: "USD" }));
    const legacyCategoryDraft = JSON.parse(JSON.stringify({ ...validDraft, category: "housing" }));

    expect(validateMarketplaceListingDraft(legacyCurrencyDraft).valid).toBe(false);
    expect(validateMarketplaceListingDraft(legacyCategoryDraft).valid).toBe(false);
  });

  it("creates listings through the authenticated publishing RPC", async () => {
    const listing = {
      id: "listing-1",
      seller_id: "student-1",
      title: "Calculus book",
      description: "Used for one semester.",
      category: "books",
      item_condition: "good",
      price: 1200,
      currency: "NGN",
      image_path: null,
      status: "active",
      created_at: "2026-10-20T00:00:00.000Z",
      updated_at: "2026-10-20T00:00:00.000Z",
    };
    const rpc = vi.fn().mockResolvedValue({ data: listing, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await saveMarketplaceListing(client, "student-1", validDraft);

    expect(result).toEqual({ data: listing, error: null });
    expect(rpc).toHaveBeenCalledWith("create_mtu_marketplace_listing", {
      p_title: "Calculus book",
      p_description: "Used for one semester.",
      p_category: "books",
      p_condition: "good",
      p_price: 1200,
      p_image_path: null,
    });
  });
});
