// Style contract: Warm-pastel editorial MTU landing page with scroll-driven storytelling and purposeful interaction feedback.
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem("convo-install-dismissed") === "true");

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  useEffect(() => {
    const handleInstallRequest = () => {
      if (installEvent) void installEvent.prompt().then(() => setInstallEvent(null));
    };
    window.addEventListener("convo-install-request", handleInstallRequest);
    return () => window.removeEventListener("convo-install-request", handleInstallRequest);
  }, [installEvent]);

  if (!installEvent || dismissed) return null;
  return <aside className="install-app-prompt" aria-label="Install Convo">
    <img src="/convo-icon.png" alt="" />
    <span><strong>Install Convo</strong><small>Use Convo like a desktop app — no Microsoft Store needed.</small></span>
    <button type="button" className="primary-button small" onClick={() => void installEvent.prompt().then(() => setInstallEvent(null))}><Download size={14} /> Install</button>
    <button type="button" className="install-app-dismiss" aria-label="Dismiss install prompt" onClick={() => { window.localStorage.setItem("convo-install-dismissed", "true"); setDismissed(true); }}><X size={14} /></button>
  </aside>;
}
function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Toaster position="bottom-right" />
        <InstallAppPrompt />
        <Router />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
