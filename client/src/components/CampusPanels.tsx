import React from "react";
import { Bell, Heart, Users } from "lucide-react";
import type { CampusGroup, CampusPost, CampusStory } from "@/lib/campus-data";

type Props = {
  stories: CampusStory[];
  posts: CampusPost[];
  groups: CampusGroup[];
  isLoading: boolean;
  error: string | null;
  isLive: boolean;
  onAction: (label: string) => void;
};

export function CampusPanels({ stories, posts, groups, isLoading, error, isLive, onAction }: Props) {
  return <>
    <div className="story-strip" data-testid="stories-panel"><div className="strip-label"><span>Stories</span><small>{error ? "Circles are taking a pause" : isLive ? "live from your circles" : "your campus circles"}</small></div>{isLoading ? <div className="panel-state">Loading stories…</div> : error ? <div className="panel-state error-state">Stories unavailable</div> : stories.length ? stories.map((story) => <button key={story.id} className="story-avatar" onClick={() => onAction(`${story.name}'s story`)}><span className={`avatar-fill ${story.tone}`}>{story.initials}</span><small>{story.name}</small></button>) : <div className="panel-state">No stories yet — start the first one.</div>}<button className="story-more" onClick={() => onAction("Story discovery")}><span>+</span><small>Explore</small></button></div>
    <div className="live-feed-strip" data-testid="feed-panel"><div className="feed-heading"><span>Live feed</span><small>{isLive ? "updated just now" : "ready for you"}</small></div>{isLoading ? <div className="feed-empty">Gathering the latest conversations…</div> : error ? <div className="feed-empty error-state">We couldn’t load posts right now. Please try again shortly.</div> : posts.length ? posts.slice(0, 3).map((post) => <button className="feed-line" key={post.id} onClick={() => onAction("Post details")}><span className={`feed-avatar ${post.tone}`}>{post.author_name.slice(0, 2).toUpperCase()}</span><span><b>{post.author_name}</b><small>{post.body}</small></span><Heart size={14} /></button>) : <div className="feed-empty">No posts yet — your campus pulse starts here.</div>}</div>
    <div className="feature-stack" data-testid="groups-panel">{isLoading ? <div className="panel-state">Loading your groups…</div> : error ? <div className="panel-state error-state">Groups unavailable — please try again shortly.</div> : groups.length ? groups.slice(0, 3).map((group, index) => <button key={group.id} className={`feature-card ${index === 0 ? "coral-card" : index === 1 ? "sage-card" : "butter-card"}`} onClick={() => onAction(group.name)}><span className="feature-number">0{index + 1}</span><span className="feature-icon">{index === 0 ? <Bell size={19} /> : index === 1 ? <Users size={19} /> : <Heart size={19} />}</span><span><b>{group.name}</b><small>{group.meta} · {group.members} members {group.active ? "· active now" : ""}</small></span></button>) : <div className="panel-state">No groups yet — create the first circle.</div>}</div>
  </>;
}
