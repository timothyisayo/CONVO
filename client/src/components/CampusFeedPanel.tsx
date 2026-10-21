import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bookmark, CalendarDays, Check, Flag, Heart, ImagePlus, MessageCircle, Pencil, Search, Send, Share2, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampusPost, CampusPostComment } from "@/lib/campus-data";
import { createCampusPost, createCampusPostComment, createCampusPostWithMedia, deleteCampusPost, deleteCampusPostComment, loadCampusPostComments, loadCampusPostPage, loadMyCampusPostReactions, loadMyCampusPostSaves, reportCampusPost, toggleCampusPostReaction, toggleCampusPostSave, updateCampusPost, validateCampusPostMedia } from "@/lib/campus-data";
import { StatusStories } from "@/components/StatusStories";
import "./marketplace.css";
import "./short-video-feed.css";

type Props = {
  client: SupabaseClient | null;
  posts: CampusPost[];
  currentUserId?: string;
  displayName: string;
  avatarUrl?: string;
  viewMode?: "feed" | "campus";
  onOpenMessages: () => void;
  onOpenMarketplace: () => void;
  onOpenEvents: () => void;
  onMessageMember: (memberId: string) => Promise<{ error: string | null }>;
  onOpenMemberProfile?: (memberId: string, displayName: string) => void;
};

export function CampusFeedPanel({
  client,
  posts,
  currentUserId,
  displayName,
  avatarUrl,
  viewMode = "campus",
  onOpenMessages,
  onOpenMarketplace,
  onOpenEvents,
  onMessageMember,
  onOpenMemberProfile,
}: Props) {
  const [query, setQuery] = useState("");
  const [showVideoFeed, setShowVideoFeed] = useState(false);
  const [searchResults, setSearchResults] = useState<CampusPost[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [draft, setDraft] = useState("");
  const [mediaDraft, setMediaDraft] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [editingPostId, setEditingPostId] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [likedByMe, setLikedByMe] = useState<Record<string, boolean>>({});
  const [savedByMe, setSavedByMe] = useState<Record<string, boolean>>({});
  const [reportingPostId, setReportingPostId] = useState("");
  const [reportReason, setReportReason] = useState("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const [localPosts, setLocalPosts] = useState<CampusPost[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(Boolean(client));
  const [feedError, setFeedError] = useState("");
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedRetry, setFeedRetry] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openDiscussionId, setOpenDiscussionId] = useState("");
  const [commentsByPost, setCommentsByPost] = useState<Record<string, CampusPostComment[]>>({});
  const [loadedDiscussionIds, setLoadedDiscussionIds] = useState<string[]>([]);
  const [commentsLoadingByPost, setCommentsLoadingByPost] = useState<Record<string, boolean>>({});
  const [commentError, setCommentError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const postRequestIdRef = useRef(crypto.randomUUID());
  const postRequestSnapshotRef = useRef<{ body: string; files: File[] } | null>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const mediaPreviewUrls = useMemo(() => mediaDraft.map((file) => URL.createObjectURL(file)), [mediaDraft]);

  useEffect(() => () => mediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url)), [mediaPreviewUrls]);

  useEffect(() => {
    const videos = [...videoRefs.current.entries()];
    if (!videos.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      }
    }, { threshold: [0, 0.6, 1] });
    videos.forEach(([, video]) => observer.observe(video));
    return () => observer.disconnect();
  }, [localPosts, posts, searchResults]);

  useEffect(() => setLocalPosts(null), [posts]);

  useEffect(() => {
    if (!client) {
      setFeedLoading(false);
      setFeedError("Sign in to read the live Convo community feed.");
      return;
    }
    let active = true;
    setFeedLoading(true);
    setFeedError("");
    void loadCampusPostPage(client).then((result) => {
      if (!active) return;
      if (result.error) setFeedError(result.error.message);
      else {
        setFeedError("");
        setLocalPosts(result.data);
        setFeedHasMore(result.hasMore);
      }
    }).catch((caught: unknown) => {
      if (active) setFeedError(caught instanceof Error ? caught.message : "Campus Hub could not load.");
    }).finally(() => {
      if (active) setFeedLoading(false);
    });
    return () => { active = false; };
  }, [client, feedRetry]);

  useEffect(() => {
    if (!query.trim() || !client) {
      setSearchResults(null);
      setSearchError("");
      setSearchHasMore(false);
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchResults([]);
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void loadCampusPostPage(client, query.trim()).then((result) => {
        if (!active) return;
        if (result.error) {
          setSearchError(result.error.message);
          setSearchResults([]);
        } else {
          setSearchError("");
          setSearchResults(result.data);
          setSearchHasMore(result.hasMore);
        }
      }).catch((caught: unknown) => {
        if (!active) return;
        setSearchError(caught instanceof Error ? caught.message : "Campus search is unavailable.");
        setSearchResults([]);
      }).finally(() => { if (active) setSearchLoading(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, query]);

  const sourcePosts = localPosts ?? posts;
  const visiblePosts = searchResults ?? (query.trim()
    ? sourcePosts.filter((post) => `${post.author_name} ${post.author_meta} ${post.body}`.toLowerCase().includes(query.trim().toLowerCase()))
    : sourcePosts);
  const feedDisplayPosts = showVideoFeed
    ? visiblePosts.filter((post) => post.media?.some((item) => item.media_type === "video"))
    : visiblePosts;
  const hasMorePosts = query.trim() ? searchHasMore : feedHasMore;

  const loadMorePosts = async () => {
    if (!client || loadingMore || !hasMorePosts || !visiblePosts.length) return;
    setLoadingMore(true);
    try {
      const cursor = visiblePosts[visiblePosts.length - 1];
      const result = await loadCampusPostPage(client, query, cursor);
      if (result.error) {
        toast.error("Couldn’t load older posts", { description: result.error.message });
        return;
      }
      const existingIds = new Set(visiblePosts.map((post) => post.id));
      const unique = result.data.filter((post) => !existingIds.has(post.id));
      if (query.trim()) {
        setSearchResults((current) => [...(current || []), ...unique]);
        setSearchHasMore(result.hasMore);
      } else {
        setLocalPosts((current) => {
          const existing = current ?? posts;
          const ids = new Set(existing.map((post) => post.id));
          return [...existing, ...result.data.filter((post) => !ids.has(post.id))];
        });
        setFeedHasMore(result.hasMore);
      }
    } catch (caught) {
      toast.error("Couldn’t load older posts", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!client || !currentUserId) {
      setLikedByMe({});
      setSavedByMe({});
      return;
    }
    let active = true;
    void loadMyCampusPostReactions(client, sourcePosts.map((post) => post.id)).then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error("Couldn’t load your post reactions", { description: result.error.message });
        return;
      }
      setLikedByMe(Object.fromEntries(result.data.map((postId) => [postId, true])));
    }).catch((caught: unknown) => {
      if (active) toast.error("Couldn’t load your post reactions", { description: caught instanceof Error ? caught.message : "Please refresh and try again." });
    });
    return () => { active = false; };
  }, [client, currentUserId, sourcePosts]);

  useEffect(() => {
    if (!client || !currentUserId) {
      setSavedByMe({});
      return;
    }
    let active = true;
    void loadMyCampusPostSaves(client, sourcePosts.map((post) => post.id)).then((result) => {
      if (!active) return;
      if (result.error) {
        toast.error("Couldn’t load your saved posts", { description: result.error.message });
        return;
      }
      setSavedByMe(Object.fromEntries(result.data.map((postId) => [postId, true])));
    }).catch((caught: unknown) => {
      if (active) toast.error("Couldn’t load your saved posts", { description: caught instanceof Error ? caught.message : "Please refresh and try again." });
    });
    return () => { active = false; };
  }, [client, currentUserId, sourcePosts]);

  const createPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || busyAction) return;
    if (!draft.trim() && mediaDraft.length === 0) return;
    const body = draft.trim();
    const previousSnapshot = postRequestSnapshotRef.current;
    if (previousSnapshot && (
      previousSnapshot.body !== body
      || previousSnapshot.files.length !== mediaDraft.length
      || previousSnapshot.files.some((file, index) => file !== mediaDraft[index])
    )) {
      postRequestIdRef.current = crypto.randomUUID();
    }
    postRequestSnapshotRef.current = { body, files: [...mediaDraft] };
    setBusyAction("create");
    setUploadProgress(mediaDraft.length ? { completed: 0, total: mediaDraft.length } : null);
    try {
      const result = mediaDraft.length
        ? await createCampusPostWithMedia(client, currentUserId || "", body, mediaDraft, postRequestIdRef.current, (completed, total) => setUploadProgress({ completed, total }))
        : await createCampusPost(client, body, postRequestIdRef.current);
      if ("persisted" in result && result.persisted) {
        if (result.data) {
          setLocalPosts((current) => [result.data!, ...(current ?? posts).filter((post) => post.id !== result.data!.id)]);
        }
        setDraft("");
        setMediaDraft([]);
        postRequestIdRef.current = crypto.randomUUID();
        postRequestSnapshotRef.current = null;
        if (result.error || !result.data) {
          setFeedRetry((value) => value + 1);
          toast.success("Your post was published", { description: "The feed could not confirm it yet. Use Try again to refresh; do not submit it again." });
          return;
        }
        if (result.data.media?.some((item) => item.media_unavailable)) {
          toast.success("Your post is live", { description: "Some media could not be loaded. The post itself is published." });
          return;
        }
        toast.success("Your community post is live");
        return;
      }
      if (result.error || !result.data) {
        toast.error("Couldn’t publish your post", { description: result.error?.message || "Please try again." });
        return;
      }
    } catch (caught) {
      toast.error("We couldn’t confirm the post result", { description: "Your draft is preserved. Retrying this submission will not create a duplicate." });
    } finally {
      setBusyAction("");
      setUploadProgress(null);
    }
  };

  const addMedia = (files: FileList | null) => {
    if (!files) return;
    const next = [...mediaDraft, ...Array.from(files)];
    const result = validateCampusPostMedia(next);
    if (!result.valid) {
      toast.error("Couldn’t add media", { description: result.error });
      return;
    }
    setMediaDraft(next);
  };

  const saveEdit = async (postId: string) => {
    if (!client || !editingBody.trim() || busyAction) return;
    setBusyAction(postId);
    try {
      const result = await updateCampusPost(client, postId, editingBody.trim());
      if (result.error || !result.ok) {
        toast.error("Couldn’t update your post", { description: result.error?.message || "You can only edit your own post." });
        return;
      }
      setLocalPosts((current) => (current ?? posts).map((post) => post.id === postId ? { ...post, body: editingBody.trim() } : post));
      setEditingPostId("");
      toast.success("Post updated");
    } catch (caught) {
      toast.error("Couldn’t update your post", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusyAction("");
    }
  };

  const deletePost = async (postId: string) => {
    if (!client || busyAction) return;
    setBusyAction(postId);
    try {
      const result = await deleteCampusPost(client, postId);
      if (!result.ok) {
        toast.error("Couldn’t delete your post", { description: result.error?.message || "You can only delete your own post." });
        return;
      }
      setLocalPosts((current) => (current ?? posts).filter((post) => post.id !== postId));
      setConfirmingDeleteId("");
      if (result.error) toast.error("Post deleted, but its media could not be fully removed", { description: result.error.message });
      else toast.success("Post deleted");
    } catch (caught) {
      toast.error("Couldn’t delete your post", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusyAction("");
    }
  };

  const toggleReaction = async (postId: string) => {
    if (!client || busyAction) return;
    setBusyAction(postId);
    try {
      const result = await toggleCampusPostReaction(client, postId);
      if (result.error || !result.data) {
        toast.error("Couldn’t save your reaction", { description: result.error?.message || "Please try again." });
        return;
      }
      setLikedByMe((current) => ({ ...current, [postId]: result.data!.liked }));
      setLocalPosts((current) => (current ?? posts).map((post) => post.id === postId ? { ...post, likes: result.data!.like_count } : post));
    } catch (caught) {
      toast.error("Couldn’t save your reaction", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusyAction("");
    }
  };

  const toggleSave = async (postId: string) => {
    if (!client || !currentUserId || busyAction) return;
    setBusyAction(postId);
    try {
      const result = await toggleCampusPostSave(client, postId);
      if (result.error || result.data === null) {
        toast.error("Couldn’t update saved posts", { description: result.error?.message || "Please try again." });
        return;
      }
      setSavedByMe((current) => ({ ...current, [postId]: result.data! }));
      toast.success(result.data ? "Post saved" : "Post removed from saved");
    } catch (caught) {
      toast.error("Couldn’t update saved posts", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusyAction("");
    }
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !currentUserId || !reportingPostId || busyAction) return;
    setBusyAction(reportingPostId);
    try {
      const result = await reportCampusPost(client, reportingPostId, reportReason, reportDetails);
      if (result.error || !result.ok) {
        toast.error("Couldn’t submit this report", { description: result.error?.message || "Please try again." });
        return;
      }
      setReportingPostId("");
      setReportDetails("");
      toast.success("Report received", { description: "Thank you for helping keep Convo respectful." });
    } catch (caught) {
      toast.error("Couldn’t submit this report", { description: caught instanceof Error ? caught.message : "Please try again." });
    } finally {
      setBusyAction("");
    }
  };

  const messageMember = async (memberId: string) => {
    try {
      return await onMessageMember(memberId);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "Please try again.";
      return { error };
    }
  };

  const discussPost = async (authorId: string) => {
    const result = await messageMember(authorId);
    if (result.error) toast.error("Couldn’t open a conversation", { description: result.error });
  };

  const toggleDiscussion = async (postId: string) => {
    if (openDiscussionId === postId) {
      setOpenDiscussionId("");
      return;
    }
    setOpenDiscussionId(postId);
    setCommentDraft("");
    setCommentError("");
    if (!client) {
      setCommentError("Sign in to view this discussion.");
      return;
    }
    if (loadedDiscussionIds.includes(postId)) return;
    setCommentsLoadingByPost((current) => ({ ...current, [postId]: true }));
    try {
      const result = await loadCampusPostComments(client, postId);
      if (result.error) {
        setCommentError(result.error.message);
        toast.error("Couldn’t load this discussion", { description: result.error.message });
        return;
      }
      setCommentsByPost((current) => ({ ...current, [postId]: result.data }));
      setLoadedDiscussionIds((current) => current.includes(postId) ? current : [...current, postId]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please try again.";
      setCommentError(message);
      toast.error("Couldn’t load this discussion", { description: message });
    } finally {
      setCommentsLoadingByPost((current) => ({ ...current, [postId]: false }));
    }
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>, postId: string) => {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!client || !currentUserId || !body || commentBusy) return;
    setCommentBusy(true);
    setCommentError("");
    try {
      const created = await createCampusPostComment(client, postId, body);
      if (created.error || !created.data) {
        const message = created.error?.message || "Please try again.";
        setCommentError(message);
        toast.error("Couldn’t post your comment", { description: message });
        return;
      }
      const refreshed = await loadCampusPostComments(client, postId);
      if (refreshed.error) {
        setCommentError(refreshed.error.message);
        toast.error("Comment posted, but the discussion could not refresh", { description: refreshed.error.message });
        return;
      }
      setCommentsByPost((current) => ({ ...current, [postId]: refreshed.data }));
      setLoadedDiscussionIds((current) => current.includes(postId) ? current : [...current, postId]);
      setCommentDraft("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please try again.";
      setCommentError(message);
      toast.error("Couldn’t post your comment", { description: message });
    } finally {
      setCommentBusy(false);
    }
  };

  const removeComment = async (comment: CampusPostComment) => {
    if (!client || commentBusy) return;
    setCommentBusy(true);
    try {
      const result = await deleteCampusPostComment(client, comment.id);
      if (result.error || !result.ok) {
        const message = result.error?.message || "You can only delete your own comment.";
        setCommentError(message);
        toast.error("Couldn’t delete your comment", { description: message });
        return;
      }
      setCommentsByPost((current) => ({
        ...current,
        [comment.post_id]: (current[comment.post_id] || []).filter((item) => item.id !== comment.id),
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Please try again.";
      setCommentError(message);
      toast.error("Couldn’t delete your comment", { description: message });
    } finally {
      setCommentBusy(false);
    }
  };

  const sharePost = async (post: CampusPost) => {
    const url = new URL(window.location.href);
    url.hash = `campus-post-${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Post by ${post.author_name}`, url: url.toString() });
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error("Link sharing is not available in this browser.");
      await navigator.clipboard.writeText(url.toString());
      toast.success("Post link copied");
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      toast.error("Couldn’t share this post", { description: caught instanceof Error ? caught.message : "Please try again." });
    }
  };

  return (
    <section className={`workspace-view premium-feature-view ${viewMode === "feed" ? "convo-social-feed-view" : "campus-hub-view"}`}>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow dark">{viewMode === "feed" ? "Convo community" : "Campus workspace"}</span>
          <h1>{viewMode === "feed" ? <>Your<br /><em>feed.</em></> : <>Campus<br /><em>Hub.</em></>}</h1>
          <p>{viewMode === "feed" ? "Posts from eligible Convo members. Content is member-submitted, not official university information." : "Explore member posts and connection-only Stories. Content is user-submitted, not official university information."}</p>
        </div>
        <div className="workspace-heading-actions">
          <button className="outline-button" onClick={onOpenMarketplace}><Search size={15} /> Marketplace</button>
          <button
            className="outline-button"
            type="button"
            aria-pressed={showVideoFeed}
            onClick={() => setShowVideoFeed((current) => !current)}
          ><Video size={16} /> {showVideoFeed ? "All posts" : "Short videos"}</button>
          <button className="outline-button" onClick={onOpenEvents}><CalendarDays size={16} /> Group activity</button>
        </div>
      </div>
      {currentUserId && <StatusStories currentUserId={currentUserId} displayName={displayName} avatarUrl={avatarUrl} audience="public" />}
      <label className="campus-search">
        <Search size={16} />
        <span className="sr-only">Search community posts</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search community posts..." />
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}
      </label>
      {client && currentUserId && <form className="campus-composer" onSubmit={(event) => void createPost(event)}>
        <label htmlFor="campus-post-draft">Share with the Convo community</label>
        <textarea id="campus-post-draft" value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)} placeholder="What would you like to share?" />
        {mediaDraft.length > 0 && <div className="campus-media-previews">{mediaDraft.map((file, index) => <figure key={`${file.name}-${index}`}>
          {file.type.startsWith("video/") ? <video src={mediaPreviewUrls[index]} controls muted playsInline /> : <img src={mediaPreviewUrls[index]} alt={`Post preview ${index + 1}`} />}
          <figcaption>{file.name}</figcaption>
          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setMediaDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button>
        </figure>)}</div>}
        <input ref={mediaInputRef} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" aria-label="Choose post images or video" onChange={(event) => { addMedia(event.currentTarget.files); event.currentTarget.value = ""; }} />
        {uploadProgress && <progress aria-label="Post media upload progress" value={uploadProgress.completed} max={uploadProgress.total} />}
        <div className="campus-composer-footer"><small>{draft.length}/2000</small><div className="campus-composer-actions"><button type="button" className="outline-button" onClick={() => mediaInputRef.current?.click()} disabled={busyAction === "create"}><ImagePlus size={15} /> Add photos or video</button><button className="primary-button" type="submit" disabled={busyAction === "create" || (!draft.trim() && mediaDraft.length === 0)}><Send size={15} /> {uploadProgress ? `Uploading ${uploadProgress.completed}/${uploadProgress.total}` : busyAction === "create" ? "Publishing..." : "Publish post"}</button></div></div>
      </form>}
      {feedLoading || searchLoading ? <div className="campus-pulse-list" aria-busy="true"><div className="campus-post-skeleton" /><div className="campus-post-skeleton" /></div>
        : feedError ? <div className="premium-empty-state" role="alert"><h2>Feed is unavailable.</h2><p>{feedError}</p><button className="outline-button" type="button" onClick={() => setFeedRetry((value) => value + 1)}>Try again</button></div>
          : searchError ? <div className="premium-empty-state" role="alert"><h2>Search is unavailable.</h2><p>{searchError}</p></div>
            : feedDisplayPosts.length ? <div role="region" className={`campus-pulse-list ${showVideoFeed ? "short-video-feed" : ""}`} aria-label={showVideoFeed ? "Short video feed" : "Community posts"}>{feedDisplayPosts.map((post) => {
              const isOwner = post.author_id === currentUserId;
              const isEditing = editingPostId === post.id;
              return <article className={`campus-pulse-card ${showVideoFeed ? "short-video-feed-item" : ""}`} id={`campus-post-${post.id}`} key={post.id}>
                <span className={`feed-avatar ${post.tone}`}>{post.author_avatar_url ? <img src={post.author_avatar_url} alt="" /> : post.author_name.slice(0, 2).toUpperCase()}</span>
                <div className="campus-post-content">
                  <div className="campus-post-byline">
                    <div>{post.author_id && onOpenMemberProfile ? <button type="button" className="campus-author-link" onClick={() => onOpenMemberProfile(post.author_id!, post.author_name)}>{post.author_name}</button> : <b>{post.author_name}</b>}<small>{post.author_meta}</small></div>
                    {post.created_at && <time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>}
                  </div>
                  {isEditing
                    ? <form onSubmit={(event) => { event.preventDefault(); void saveEdit(post.id); }}><textarea aria-label="Edit post" value={editingBody} maxLength={2000} onChange={(event) => setEditingBody(event.target.value)} /><div className="campus-post-edit-actions"><button type="button" className="outline-button" onClick={() => setEditingPostId("")}>Cancel</button><button className="primary-button" type="submit" disabled={!editingBody.trim() || busyAction === post.id}><Check size={14} /> Save</button></div></form>
                    : post.body.trim() ? <p>{post.body}</p> : null}
                  {post.media?.length ? <div className={`campus-post-media ${post.media.length > 1 ? "has-gallery" : ""}`}>
                    {post.media.map((item, index) => item.media_unavailable || !item.media_url
                      ? <p key={item.media_path} className="campus-media-unavailable" role="status">This media is temporarily unavailable.</p>
                      : item.media_type === "video"
                      ? <video key={item.media_path} ref={(element) => { if (element) videoRefs.current.set(item.media_path, element); else videoRefs.current.delete(item.media_path); }} src={item.media_url} controls playsInline muted preload={showVideoFeed ? "none" : "metadata"} aria-label={`Video post by ${post.author_name}`} />
                      : <a key={item.media_path} href={item.media_url} target="_blank" rel="noreferrer" aria-label={`Open post image ${index + 1}`}><img src={item.media_url} alt={`Post image ${index + 1} by ${post.author_name}`} loading="lazy" /></a>)}
                  </div> : null}
                  <div className="post-actions">
                    {client && <button type="button" aria-pressed={Boolean(likedByMe[post.id])} onClick={() => void toggleReaction(post.id)}><Heart size={14} fill={likedByMe[post.id] ? "currentColor" : "none"} /> {post.likes}</button>}
                    <button
                      type="button"
                      aria-expanded={openDiscussionId === post.id}
                      aria-controls={`campus-discussion-${post.id}`}
                      onClick={() => void toggleDiscussion(post.id)}
                    ><MessageCircle size={13} /> Discuss</button>
                    <button type="button" aria-label="Share post" onClick={() => void sharePost(post)}><Share2 size={13} /></button>
                    {client && currentUserId && <button type="button" aria-pressed={Boolean(savedByMe[post.id])} aria-label={savedByMe[post.id] ? "Remove saved post" : "Save post"} onClick={() => void toggleSave(post.id)}><Bookmark size={13} fill={savedByMe[post.id] ? "currentColor" : "none"} /> {savedByMe[post.id] ? "Saved" : "Save"}</button>}
                    {client && currentUserId && !isOwner && <button type="button" aria-expanded={reportingPostId === post.id} aria-label="Report post" onClick={() => { setReportingPostId((current) => current === post.id ? "" : post.id); setReportDetails(""); }}><Flag size={13} /> Report</button>}
                    {isOwner && !isEditing && client && <button type="button" aria-label="Edit your post" onClick={() => { setEditingPostId(post.id); setEditingBody(post.body); setConfirmingDeleteId(""); }}><Pencil size={13} /></button>}
                    {isOwner && !isEditing && client && (confirmingDeleteId === post.id
                      ? <span className="campus-delete-confirm"><span>Delete this post?</span><button type="button" onClick={() => void deletePost(post.id)} disabled={busyAction === post.id}>Delete</button><button type="button" aria-label="Cancel delete" onClick={() => setConfirmingDeleteId("")}>Cancel</button></span>
                      : <button type="button" aria-label="Delete your post" onClick={() => setConfirmingDeleteId(post.id)}><Trash2 size={13} /></button>)}
                  </div>
                  {reportingPostId === post.id && <form className="campus-report-form" onSubmit={(event) => void submitReport(event)}>
                    <label htmlFor={`campus-report-reason-${post.id}`}>Why are you reporting this post?</label>
                    <select id={`campus-report-reason-${post.id}`} value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                      <option value="spam">Spam or misleading</option>
                      <option value="harassment">Harassment or bullying</option>
                      <option value="inappropriate">Inappropriate content</option>
                      <option value="misinformation">False or harmful information</option>
                      <option value="other">Something else</option>
                    </select>
                    <label className="sr-only" htmlFor={`campus-report-details-${post.id}`}>Additional details (optional)</label>
                    <textarea id={`campus-report-details-${post.id}`} value={reportDetails} maxLength={1000} onChange={(event) => setReportDetails(event.target.value)} placeholder="Add context (optional)" />
                    <div><button type="button" className="outline-button" onClick={() => setReportingPostId("")}>Cancel</button><button className="primary-button" type="submit" disabled={busyAction === post.id}><Flag size={13} /> Submit report</button></div>
                  </form>}
                  {openDiscussionId === post.id && <section className="campus-discussion" id={`campus-discussion-${post.id}`} aria-label={`Discussion for ${post.author_name}`}>
                    <div className="campus-discussion-heading">
                      <strong>Comments</strong>
                      {post.author_id && post.author_id !== currentUserId && <button type="button" className="text-link" onClick={() => void discussPost(post.author_id!)}>Message poster</button>}
                    </div>
                    {commentsLoadingByPost[post.id] ? <p className="campus-discussion-state" role="status">Loading comments…</p>
                      : commentError ? <p className="campus-discussion-state" role="alert">{commentError}</p>
                        : commentsByPost[post.id]?.length ? <div className="campus-comment-list">{commentsByPost[post.id].map((comment) => <article className="campus-comment" key={comment.id}>
                          <span className="campus-comment-avatar">{comment.author_avatar_url ? <img src={comment.author_avatar_url} alt="" /> : comment.author_name.slice(0, 2).toUpperCase()}</span>
                          <div className="campus-comment-body">
                            <div className="campus-comment-meta"><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time>
                              {comment.author_id === currentUserId && <button type="button" aria-label="Delete your comment" onClick={() => void removeComment(comment)} disabled={commentBusy}><Trash2 size={13} /></button>}
                            </div>
                            <p>{comment.body}</p>
                          </div>
                        </article>)}</div>
                          : <p className="campus-discussion-state">No comments yet. Start the discussion.</p>}
                    {client && currentUserId
                      ? <form className="campus-comment-form" onSubmit={(event) => void submitComment(event, post.id)}>
                        <label className="sr-only" htmlFor={`campus-comment-${post.id}`}>Write a comment</label>
                        <textarea id={`campus-comment-${post.id}`} value={commentDraft} maxLength={1000} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment…" />
                        <button className="primary-button" type="submit" disabled={commentBusy || !commentDraft.trim()}><Send size={13} /> Comment</button>
                      </form>
                      : <p className="campus-discussion-state">Sign in to add a comment.</p>}
                  </section>}
                </div>
              </article>;
            })}</div>
              : <div className="premium-empty-state"><span className="empty-orbit">{showVideoFeed ? <Video size={22} /> : <Search size={22} />}</span><h2>{showVideoFeed ? "No videos in the loaded posts." : query ? "No community posts match." : "The community feed is quiet."}</h2><p>{showVideoFeed ? hasMorePosts ? "Load older posts to look for more videos." : "Video posts shared by eligible Convo members will appear here." : query ? "Try a different search." : "Real posts from Convo members will appear here when they are shared."}</p></div>}
      {!feedLoading && !feedError && visiblePosts.length > 0 && hasMorePosts && <div className="campus-load-more"><button className="outline-button" type="button" onClick={() => void loadMorePosts()} disabled={loadingMore}>{loadingMore ? "Loading older posts…" : showVideoFeed ? "Load older videos" : "Load older posts"}</button></div>}
    </section>
  );
}
