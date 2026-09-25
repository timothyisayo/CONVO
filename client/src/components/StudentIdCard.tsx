import React from "react";
import { Eye, EyeOff, Rotate3D, ShieldCheck } from "lucide-react";

type Props = { nickname: string; displayName: string; studentId: string; programme: string; college: string; level: string; bio?: string; avatarUrl?: string; visibility?: { programme: boolean; college: boolean; level: boolean; bio?: boolean } };
export const StudentIdCardVisibilityContext = React.createContext<{ programme: boolean; college: boolean; level: boolean; bio: boolean }>({ programme: true, college: true, level: true, bio: true });

export function StudentIdCard({ nickname, displayName, studentId, programme, college, level, bio, avatarUrl, visibility }: Props) {
  const [flipped, setFlipped] = React.useState(false);
  const inheritedVisibility = React.useContext(StudentIdCardVisibilityContext);
  const resolvedVisibility = visibility || inheritedVisibility;
  const toggle = () => setFlipped(current => !current);
  const revealPrivate = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setFlipped(true); };
  const revealPublic = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setFlipped(false); };
  const publicFacts = [resolvedVisibility.programme ? programme : "", resolvedVisibility.college ? college : "", resolvedVisibility.level ? level : ""].filter(Boolean);
  const publicBio = resolvedVisibility.bio !== false ? bio?.trim() : "";
  return <div className={`student-id-card ${flipped ? "is-flipped" : ""}`} data-flip-state={flipped ? "private" : "public"} onClick={toggle}><div className="student-id-card-inner"><section className="student-id-face student-id-front"><div className="student-id-topline"><span>CONVO · MTU</span><button type="button" onClick={revealPrivate} aria-label="Show private student ID details"><EyeOff size={15} /></button></div><span className="student-id-label">Public student card</span>{avatarUrl ? <img className="student-id-avatar" src={avatarUrl} alt="" /> : null}<strong>{nickname || "Your nickname"}</strong><div className="student-id-facts">{publicFacts.length ? publicFacts.map((fact) => <span key={fact} title={fact}>{fact}</span>) : <span>Academic details are private</span>}</div>{publicBio && <p className="student-id-bio">{publicBio}</p>}<p>{publicFacts.length ? "Only the details you chose are shown." : "Your academic details are private."}</p><button type="button" className="student-id-flip" onClick={revealPrivate}><Rotate3D size={14} /> View private side</button></section><section className="student-id-face student-id-back"><div className="student-id-topline"><span>PRIVATE VIEW</span><button type="button" onClick={revealPublic} aria-label="Show public student ID"><Eye size={15} /></button></div><span className="student-id-label">Only visible to you</span><strong>{displayName || "Your full name"}</strong><div className="student-id-private-row"><span>Student ID</span><b>{studentId || "Not issued yet"}</b></div><div className="student-id-private-row"><span>Academic details</span><b>{[programme, college, level].filter(Boolean).join(" · ") || "Not set yet"}</b></div><p><ShieldCheck size={14} /> Your private details stay under your control.</p><button type="button" className="student-id-flip" onClick={revealPublic}><Rotate3D size={14} /> Return to public side</button></section></div></div>;
}
