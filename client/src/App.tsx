// Style contract: Warm-pastel editorial MTU landing page with scroll-driven storytelling and purposeful interaction feedback.
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type InstallState = "available" | "instructions" | "installed";

function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem("convo-install-dismissed") === "true");
  const installState: InstallState = isInstalled ? "installed" : installEvent ? "available" : "instructions";

  const publishInstallState = (state: InstallState) => {
    window.dispatchEvent(new CustomEvent("convo-install-state", { detail: state }));
  };

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      publishInstallState("available");
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallEvent(null);
      publishInstallState("installed");
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    publishInstallState(installState);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    const handleInstallRequest = () => {
      if (isInstalled) return;
      if (!installEvent) {
        const isApple = /Macintosh|iPhone|iPad|iPod/i.test(navigator.userAgent);
        toast("Install Convo from your browser", {
          description: isApple
            ? "Use Share, then Add to Dock on Safari, or Add to Home Screen on iPhone/iPad."
            : "Open your browser menu and choose Install Convo, Install page as app, or Add to Home screen.",
        });
        return;
      }
      void installEvent.prompt();
      void installEvent.userChoice.then(({ outcome }) => {
        setInstallEvent(null);
        if (outcome === "accepted") setIsInstalled(true);
      });
    };
    const handleInstallStateRequest = () => publishInstallState(installState);
    window.addEventListener("convo-install-request", handleInstallRequest);
    window.addEventListener("convo-install-state-request", handleInstallStateRequest);
    return () => {
      window.removeEventListener("convo-install-request", handleInstallRequest);
      window.removeEventListener("convo-install-state-request", handleInstallStateRequest);
    };
  }, [installEvent, installState, isInstalled]);

  if (!installEvent || dismissed || isInstalled) return null;
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
