import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tab } from "@/types";

interface PersistedSlackChannel {
  id: string; name: string; is_private?: boolean; num_members?: number; topic?: string;
}

interface AppStore {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  // Persisted view state
  selectedRepo: string;
  setSelectedRepo: (repo: string) => void;
  selectedSlackChannel: PersistedSlackChannel | null;
  setSelectedSlackChannel: (ch: PersistedSlackChannel | null) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  // AI Panel state
  aiPanelOpen: boolean;
  setAIPanelOpen: (open: boolean) => void;
  toggleAIPanel: () => void;
  currentChatSessionId: string | null;
  setCurrentChatSessionId: (id: string | null) => void;
  aiScope: "workspace" | "tab";
  setAIScope: (scope: "workspace" | "tab") => void;
  aiPanelWidth: number;
  setAIPanelWidth: (width: number) => void;
  // Meetings state
  selectedMeetingId: string | null;
  setSelectedMeetingId: (id: string | null) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeTab: "slack",
      setActiveTab: (tab) => set({ activeTab: tab }),
      selectedRepo: "__none__",
      setSelectedRepo: (repo) => set({ selectedRepo: repo }),
      selectedSlackChannel: null,
      setSelectedSlackChannel: (ch) => set({ selectedSlackChannel: ch }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      // AI Panel
      aiPanelOpen: false,
      setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
      toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),
      currentChatSessionId: null,
      setCurrentChatSessionId: (id) => set({ currentChatSessionId: id }),
      aiScope: "workspace",
      setAIScope: (scope) => set({ aiScope: scope }),
      aiPanelWidth: 440,
      setAIPanelWidth: (width) => set({ aiPanelWidth: width }),
      // Meetings
      selectedMeetingId: null,
      setSelectedMeetingId: (id) => set({ selectedMeetingId: id }),
    }),
    {
      name: "workos-state-v5",
      partialize: (state) => ({
        activeTab: state.activeTab,
        selectedRepo: state.selectedRepo,
        selectedSlackChannel: state.selectedSlackChannel,
        sidebarCollapsed: state.sidebarCollapsed,
        aiPanelOpen: state.aiPanelOpen,
        currentChatSessionId: state.currentChatSessionId,
        aiScope: state.aiScope,
        aiPanelWidth: state.aiPanelWidth,
        selectedMeetingId: state.selectedMeetingId,
      }),
    }
  )
);
