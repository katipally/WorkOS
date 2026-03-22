import { create } from "zustand"
import { api } from "@/lib/api"
import type { ServiceStatus } from "@/lib/types"

interface ServicesState {
  services: ServiceStatus[]
  loading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
}

export const useServicesStore = create<ServicesState>((set) => ({
  services: [],
  loading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null })
    try {
      const services = await api.getServiceStatus()
      set({ services, loading: false })
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load services",
        loading: false,
      })
    }
  },
}))
