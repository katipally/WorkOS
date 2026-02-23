import { useTheme } from "next-themes";
import { useAppStore } from "@/store/useAppStore";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Hash, Github, Settings,
  Moon, Sun, Monitor,
} from "lucide-react";
import type { Tab } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const { setActiveTab } = useAppStore();
  const { setTheme } = useTheme();

  const go = (tab: Tab) => { setActiveTab(tab); onClose(); };

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput placeholder="Navigate or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem value="navigate-slack" onSelect={() => go("slack")}>
            <Hash className="mr-2 h-4 w-4" />
            Slack
          </CommandItem>
          <CommandItem value="navigate-github" onSelect={() => go("github")}>
            <Github className="mr-2 h-4 w-4" />
            GitHub
          </CommandItem>
          <CommandItem value="navigate-settings" onSelect={() => go("settings")}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Theme">
          <CommandItem value="theme-dark" onSelect={() => { setTheme("dark"); onClose(); }}>
            <Moon className="mr-2 h-4 w-4" />
            Dark mode
          </CommandItem>
          <CommandItem value="theme-light" onSelect={() => { setTheme("light"); onClose(); }}>
            <Sun className="mr-2 h-4 w-4" />
            Light mode
          </CommandItem>
          <CommandItem value="theme-system" onSelect={() => { setTheme("system"); onClose(); }}>
            <Monitor className="mr-2 h-4 w-4" />
            System theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
