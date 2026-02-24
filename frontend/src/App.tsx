import { useState, useEffect, lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useAppStore } from "@/store/useAppStore";
import type { Tab } from "@/types";
import {
  Hash, Github, Settings,
  Moon, Sun, Search, PanelLeftClose, PanelLeftOpen, Bot, Video, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const SlackView = lazy(() => import("@/components/slack/SlackView"));
const GitHubView = lazy(() => import("@/components/github/GitHubView"));
const MeetingsView = lazy(() =>
  import("@/components/meetings/MeetingsView").then((mod) => ({ default: mod.MeetingsView }))
);
const SettingsView = lazy(() => import("@/components/settings/SettingsView"));
const AIPanel = lazy(() => import("@/components/ai/AIPanel").then((mod) => ({ default: mod.AIPanel })));
const CommandPalette = lazy(() => import("@/components/command-palette"));

const NAV_TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "slack", label: "Slack", icon: Hash },
  { id: "github", label: "GitHub", icon: Github },
  { id: "meetings", label: "Meetings", icon: Video },
];

function NavItem({
  label, icon: Icon, active, collapsed, onClick,
}: { label: string; icon: React.ComponentType<{ className?: string }>; active: boolean; collapsed: boolean; onClick: () => void }) {
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center rounded-md text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </button>
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}

function TabLoadingFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
      Loading view...
    </div>
  );
}

export default function App() {
  const { activeTab, setActiveTab, sidebarCollapsed, setSidebarCollapsed, aiPanelOpen, toggleAIPanel } = useAppStore();
  const { theme, setTheme } = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const collapsed = sidebarCollapsed;
  const setCollapsed = setSidebarCollapsed;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(true); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Redirect stale localStorage values from removed tabs to slack.
  const activeTabSafe: Tab =
    (activeTab as string) === "chat" ||
      (activeTab as string) === "jira"
      ? "slack"
      : activeTab;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <motion.aside
        animate={{ width: collapsed ? 56 : 224 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="flex flex-col border-r bg-sidebar text-sidebar-foreground shrink-0 overflow-hidden sidebar-auto-collapse"
      >
        {/* Logo + collapse */}
        <div className={cn("flex items-center border-b border-sidebar-border shrink-0",
          collapsed ? "justify-center px-2 py-3 flex-col gap-1" : "gap-2 px-3 py-3")}>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-primary-foreground" />
          </div>
          {!collapsed && <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight truncate">WorkOS</p>
            <p className="text-[11px] text-sidebar-foreground/50">Workspace Hub</p>
          </div>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
                {collapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"} sidebar</TooltipContent>
          </Tooltip>
        </div>

        {/* Search */}
        {!collapsed ? (
          <div className="px-3 pt-3 pb-1">
            <button onClick={() => setCmdOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-sidebar-accent/50 hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors border border-sidebar-border/60">
              <Search className="w-3 h-3 shrink-0" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="hidden sm:inline-flex text-[10px] font-mono bg-background/40 border border-sidebar-border/60 rounded px-1">⌘K</kbd>
            </button>
          </div>
        ) : (
          <div className="px-2 pt-2 pb-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => setCmdOpen(true)} title="Search (⌘K)" aria-label="Search"
                  className="w-full flex items-center justify-center py-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors">
                  <Search className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Search (⌘K)</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Nav items */}
        <nav className={cn("flex-1 py-2 space-y-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
          {!collapsed && <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">Workspace</p>}
          {NAV_TABS.map(({ id, label, icon }) => (
            <NavItem key={id} label={label} icon={icon}
              active={activeTabSafe === id} collapsed={collapsed} onClick={() => setActiveTab(id)} />
          ))}
        </nav>

        {/* Bottom footer: AI toggle, settings, theme */}
        <div className={cn("pt-1 pb-3 border-t border-sidebar-border space-y-0.5", collapsed ? "px-2" : "px-3")}>
          {/* AI Panel toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size={collapsed ? "icon" : "sm"}
                onClick={toggleAIPanel}
                aria-label="Work Agent"
                className={cn("text-sidebar-foreground/60 hover:text-sidebar-foreground",
                  collapsed ? "w-full h-9" : "w-full justify-start gap-3 text-sm h-9",
                  aiPanelOpen && "bg-primary/10 text-primary font-medium")}>
                <MessageSquare className="w-4 h-4 shrink-0" />
                {!collapsed && "Work Agent"}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Work Agent</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size={collapsed ? "icon" : "sm"}
                onClick={() => setActiveTab("settings")}
                aria-label="Settings"
                className={cn("text-sidebar-foreground/60 hover:text-sidebar-foreground",
                  collapsed ? "w-full h-9" : "w-full justify-start gap-3 text-sm h-9",
                  activeTabSafe === "settings" && "bg-sidebar-accent text-sidebar-accent-foreground font-medium")}>
                <Settings className="w-4 h-4 shrink-0" />
                {!collapsed && "Settings"}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Settings</TooltipContent>}
          </Tooltip>
          {mounted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size={collapsed ? "icon" : "sm"}
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  className={cn("text-sidebar-foreground/60 hover:text-sidebar-foreground",
                    collapsed ? "w-full h-9" : "w-full justify-start gap-3 text-sm h-9")}>
                  {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
                  {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
                </Button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right">{theme === "dark" ? "Light mode" : "Dark mode"}</TooltipContent>}
            </Tooltip>
          )}
        </div>
      </motion.aside>

      <main className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden section-main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTabSafe}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.12, ease: "easeOut" }} className="h-full">
              <ErrorBoundary key={activeTabSafe}>
                <Suspense fallback={<TabLoadingFallback />}>
                  {activeTabSafe === "slack" && <SlackView />}
                  {activeTabSafe === "github" && <GitHubView />}
                  {activeTabSafe === "meetings" && <MeetingsView />}
                  {activeTabSafe === "settings" && <SettingsView />}
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* AI Panel (right side) */}
        <Suspense fallback={null}>
          <AIPanel />
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      </Suspense>
    </div>
  );
}
