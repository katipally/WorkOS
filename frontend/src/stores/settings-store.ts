import { create } from "zustand"
import type { Settings } from "@/lib/types"
import { api } from "@/lib/api"

interface SettingsStore {
  settings: Settings
  loading: boolean

  fetchSettings: () => Promise<void>
  updateSettings: (data: Partial<Settings>) => Promise<void>
  applyTheme: (theme: Settings["theme"]) => void
}

const DEFAULT_SETTINGS: Settings = {
  ollama_model: "",
  ollama_url: "http://localhost:11434",
  max_steps: 25,
  system_prompt: "",
  theme: "system",
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,

  fetchSettings: async () => {
    set({ loading: true })
    try {
      const settings = await api.getSettings()
      set({ settings, loading: false })

      // Apply theme on load
      applyThemeToDOM(settings.theme)
    } catch {
      set({ loading: false })
    }
  },

  updateSettings: async (data) => {
    const settings = await api.updateSettings(data)
    set({ settings })
    applyThemeToDOM(settings.theme)
  },

  applyTheme: (theme) => {
    applyThemeToDOM(theme)
  },
}))

function applyThemeToDOM(theme: Settings["theme"]) {
  if (typeof window === "undefined") return

  const root = document.documentElement
  if (theme === "dark") {
    root.classList.add("dark")
  } else if (theme === "light") {
    root.classList.remove("dark")
  } else {
    // system
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    root.classList.toggle("dark", prefersDark)
  }
  // Persist for the inline pre-hydration script to read
  try { localStorage.setItem("workos-theme", theme) } catch {}
}
