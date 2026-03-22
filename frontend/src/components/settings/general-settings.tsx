"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSettingsStore } from "@/stores/settings-store"

export function GeneralSettings() {
  const { settings, updateSettings } = useSettingsStore()

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold mb-1">Connection</h3>
        <p className="text-xs text-muted-foreground mb-4">Configure your Ollama instance.</p>
        <div className="space-y-2">
          <Label htmlFor="ollama-url" className="text-xs">Ollama URL</Label>
          <Input
            id="ollama-url"
            value={settings.ollama_url}
            onChange={(e) => updateSettings({ ollama_url: e.target.value })}
            placeholder="http://localhost:11434"
            className="rounded-xl"
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1">Agent Behavior</h3>
        <p className="text-xs text-muted-foreground mb-4">Control how the agent reasons and acts.</p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max-steps" className="text-xs">Max Agent Steps</Label>
            <Input
              id="max-steps"
              type="number"
              min={1}
              max={100}
              value={settings.max_steps}
              onChange={(e) =>
                updateSettings({ max_steps: parseInt(e.target.value) || 25 })
              }
              className="w-24 rounded-xl"
            />
            <p className="text-[11px] text-muted-foreground">
              Maximum reason-act loops before stopping.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="system-prompt" className="text-xs">System Prompt</Label>
            <Textarea
              id="system-prompt"
              value={settings.system_prompt}
              onChange={(e) => updateSettings({ system_prompt: e.target.value })}
              placeholder="You are a helpful AI assistant..."
              rows={5}
              className="rounded-xl font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1">Appearance</h3>
        <p className="text-xs text-muted-foreground mb-4">Customize the look and feel.</p>
        <div className="space-y-2">
          <Label htmlFor="theme" className="text-xs">Theme</Label>
          <Select
            value={settings.theme}
            onValueChange={(v) => {
              if (v) updateSettings({ theme: v as "light" | "dark" | "system" })
            }}
          >
            <SelectTrigger id="theme" className="w-40 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
