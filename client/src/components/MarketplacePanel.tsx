import React, { useEffect, useState, type FormEvent } from "react";
import { Archive, Check, ImagePlus, MessageCircle, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteMarketplaceListing,
  loadMarketplaceListings,
  saveMarketplaceListing,
  setMarketplaceListingStatus,
  type MarketplaceCategory,
  type MarketplaceCondition,
  type MarketplaceListing,
  type MarketplaceListingDraft,
} from "@/lib/marketplace";

type Props = {
  client: SupabaseClient | null;
  currentUserId: string;
  onContactSeller: (sellerId: string) => Promise<{ error: string | null }>;
};

const categories: Array<{ value: MarketplaceCategory | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "books", label: "Books" },
  { value: "electronics", label: "Electronics" },
  { value: "supplies", label: "Supplies" },
  { value: "services", label: "Services" },
  { value: "other", label: "Other" },
];

const conditions: Array<{ value: MarketplaceCondition; label: string }> = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "service", label: "Service" },
];

const emptyDraft = (): MarketplaceListingDraft => ({
  title: "",
  description: "",
  category: "books",
  condition: "good",
  price: "0",
  currency: "NGN",
  image: null,
});

function formatPrice(listing: MarketplaceListing) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: listing.currency,
    maximumFractionDigits: 2,
  }).format(Number(listing.price));
}

export function MarketplacePanel({ client, currentUserId, onContactSeller }: Props) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketplaceCategory | "all">("all");
  const [loading, setLoading] = useState(Boolean(client));
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<MarketplaceListingDraft>(emptyDraft);
  const [editingListing, setEditingListing] = useState<MarketplaceListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState("");

  useEffect(() => {
    if (!client) {
      setLoading(false);
      setListings([]);
      setError("Sign in to browse the Convo Marketplace.");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void loadMarketplaceListings(client, query, category).then((result) => {
        if (!active) return;
        if (result.error) {
          setListings([]);
          setError(result.error.message);
        } else {
          setListings(result.data);
          setError("");
        }
      }).catch((caught: unknown) => {
        if (!active) return;
        setListings([]);
        setError(caught instanceof Error ? caught.message : "Marketplace listings could not be loaded.");
      }).finally(() => {
        if (active) setLoading(false);
      });
    }, query.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, client, query]);

  const startCreate = () => {
    setEditingListing(null);
    setDraft(emptyDraft());
    setFormOpen(true);
  };

  const startEdit = (listing: MarketplaceListing) => {
    setEditingListing(listing);
    setDraft({
      title: listing.title,
      description: listing.description,
      category: listing.category,
      condition: listing.item_condition,
      price: String(listing.price),
      currency: listing.currency,
      image: null,
    });
    setFormOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !currentUserId || busy) return;
    setBusy(true);
    try {
      const result = await saveMarketplaceListing(client, currentUserId, draft, editingListing || undefined);
      if (!result.data) {
        toast.error(editingListing ? "Couldn’t update listing" : "Couldn’t publish listing", { description: result.error?.message || "Please try again." });
        return;
      }
      const savedListing = result.data;
      setListings((current) => editingListing
        ? current.map((listing) => listing.id === savedListing.id ? savedListing : listing)
        : [savedListing, ...current]);
      setFormOpen(false);
      setDraft(emptyDraft());
      setEditingListing(null);
      let refreshError = "";
      try {
        const refreshed = await loadMarketplaceListings(client, query, category);
        if (refreshed.error) {
          refreshError = refreshed.error.message;
        } else {
          setListings(refreshed.data);
        }
      } catch (caught) {
        refreshError = caught instanceof Error ? caught.message : "Please refresh and try again.";
      }
      if (result.error) toast.error("Listing saved, but its previous photo could not be removed", { description: result.error.message });
      if (refreshError) toast.error("Listing saved, but the Marketplace could not refresh", { description: refreshError });
      if (!result.error && !refreshError) toast.success(editingListing ? "Listing updated" : "Listing published");
    } catch (caught) {
      toast.error("Marketplace could not save the listing", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (listing: MarketplaceListing, status: MarketplaceListing["status"]) => {
    if (!client || !currentUserId || busy) return;
    setBusy(true);
    try {
      const result = await setMarketplaceListingStatus(client, currentUserId, listing.id, status);
      if (result.error || !result.ok) {
        toast.error("Couldn’t update listing status", { description: result.error?.message || "You can only update your own listing." });
        return;
      }
      setListings((current) => status === "hidden" ? current.filter((item) => item.id !== listing.id) : current.map((item) => item.id === listing.id ? { ...item, status } : item));
    } catch (caught) {
      toast.error("Couldn’t update listing status", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const removeListing = async (listing: MarketplaceListing) => {
    if (!client || !currentUserId || busy) return;
    setBusy(true);
    try {
      const result = await deleteMarketplaceListing(client, currentUserId, listing);
      if (!result.ok) {
        toast.error("Couldn’t delete listing", { description: result.error?.message || "You can only delete your own listing." });
        return;
      }
      setListings((current) => current.filter((item) => item.id !== listing.id));
      setConfirmingDelete("");
      if (result.error) toast.error("Listing deleted, but its photo cleanup failed", { description: result.error.message });
      else toast.success("Listing deleted");
    } catch (caught) {
      toast.error("Couldn’t delete listing", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const contactSeller = async (listing: MarketplaceListing) => {
    if (listing.seller_id === currentUserId) return;
    try {
      const result = await onContactSeller(listing.seller_id);
      if (result.error) toast.error("Couldn’t open a conversation", { description: result.error });
    } catch (caught) {
      toast.error("Couldn’t open a conversation", { description: caught instanceof Error ? caught.message : "Please try again." });
    }
  };

  return (
    <section className="marketplace-panel" id="student-marketplace">
      <div className="marketplace-heading">
        <div>
          <span className="eyebrow dark"><Tag size={13} /> Convo community listings</span>
          <h2>Student Marketplace</h2>
          <p>Member-posted listings. Convo does not verify items, sellers, prices, or payments; contact sellers directly and use your own judgment.</p>
        </div>
        {currentUserId && <button type="button" className="primary-button" onClick={startCreate}><Plus size={15} /> Create listing</button>}
      </div>
      <label className="marketplace-search">
        <Search size={15} />
        <span className="sr-only">Search listings</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search items and descriptions..." />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}
      </label>
      <div className="marketplace-categories" role="group" aria-label="Marketplace categories">
        {categories.map((item) => <button type="button" key={item.value} aria-pressed={category === item.value} className={category === item.value ? "is-active" : ""} onClick={() => setCategory(item.value)}>{item.label}</button>)}
      </div>
      {formOpen && <form className="marketplace-form" onSubmit={(event) => void submit(event)}>
        <div className="marketplace-form-heading"><h3>{editingListing ? "Edit listing" : "Create a listing"}</h3><button type="button" aria-label="Close listing form" onClick={() => setFormOpen(false)}><X size={16} /></button></div>
        <label>Title<input value={draft.title} maxLength={120} required onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /></label>
        <label>Description<textarea value={draft.description} maxLength={3000} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} /></label>
        <div className="marketplace-form-row">
          <label>Category<select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as MarketplaceCategory }))}>{categories.filter((item) => item.value !== "all").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Condition<select value={draft.condition} onChange={(event) => setDraft((value) => ({ ...value, condition: event.target.value as MarketplaceCondition }))}>{conditions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        <label>Price (NGN)<input type="number" min="0" step="0.01" value={draft.price} required onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))} /></label>
        <label className="marketplace-image-input"><ImagePlus size={15} /> Listing photo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setDraft((value) => ({ ...value, image: event.target.files?.[0] || null }))} />{draft.image && <small>{draft.image.name}</small>}</label>
        <div className="marketplace-form-actions"><button type="button" className="outline-button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving..." : editingListing ? "Save changes" : "Publish listing"}</button></div>
      </form>}
      {loading ? <div className="marketplace-listings" aria-busy="true"><div className="marketplace-skeleton" /><div className="marketplace-skeleton" /></div>
        : error ? <div className="marketplace-empty" role="alert"><h3>Marketplace is unavailable.</h3><p>{error}</p></div>
          : listings.length ? <div className="marketplace-listings">{listings.map((listing) => {
            const isOwner = listing.seller_id === currentUserId;
            return <article className="marketplace-listing" key={listing.id}>
              {listing.image_url ? <a className="marketplace-listing-image" href={listing.image_url} target="_blank" rel="noreferrer" aria-label={`Open photo for ${listing.title}`}><img src={listing.image_url} alt="" /></a> : <div className="marketplace-listing-image marketplace-no-image"><Tag size={20} /></div>}
              <div className="marketplace-listing-copy">
                <div className="marketplace-listing-meta"><span>{listing.category}</span><span>{listing.item_condition.replace("_", " ")}</span>{listing.status !== "active" && <span>{listing.status}</span>}</div>
                <h3>{listing.title}</h3>
                <strong>{formatPrice(listing)}</strong>
                {listing.description && <p>{listing.description}</p>}
                <small>Listed {new Date(listing.created_at).toLocaleDateString()}</small>
                <div className="marketplace-listing-actions">
                  {isOwner ? <>
                    <button type="button" className="outline-button" onClick={() => startEdit(listing)}><Pencil size={13} /> Edit</button>
                    {listing.status === "active" ? <button type="button" className="outline-button" onClick={() => void changeStatus(listing, "sold")}><Check size={13} /> Mark sold</button> : listing.status === "sold" && <button type="button" className="outline-button" onClick={() => void changeStatus(listing, "active")}><Archive size={13} /> Relist</button>}
                    {confirmingDelete === listing.id ? <span className="marketplace-delete-confirm"><button type="button" onClick={() => void removeListing(listing)} disabled={busy}>Delete</button><button type="button" onClick={() => setConfirmingDelete("")}>Cancel</button></span> : <button type="button" className="icon-button subtle" aria-label={`Delete ${listing.title}`} onClick={() => setConfirmingDelete(listing.id)}><Trash2 size={14} /></button>}
                  </> : listing.status === "active" && <button type="button" className="primary-button" onClick={() => void contactSeller(listing)}><MessageCircle size={14} /> Message seller</button>}
                </div>
              </div>
            </article>;
          })}</div>
            : <div className="marketplace-empty"><Tag size={21} /><h3>{query ? "No listings match your search." : "No active listings yet."}</h3><p>{query ? "Try a different search or category." : "Create the first real listing for the Convo community."}</p></div>}
    </section>
  );
}
