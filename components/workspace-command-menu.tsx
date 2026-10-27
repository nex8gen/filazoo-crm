"use client";
import { Search } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

type CommandNavigationItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type CommandNavigationGroup = {
  label: string;
  items: CommandNavigationItem[];
};

export function WorkspaceCommandMenu({ navigation, open, onOpenChange, onNavigate }: {
  navigation: CommandNavigationGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (href: string) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages…" />
      <CommandList>
        <CommandEmpty><Search aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />No page found.</CommandEmpty>
        {navigation.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item, index) => (
              <CommandItem key={item.href} value={`${group.label} ${item.label}`} onSelect={() => onNavigate(item.href)}>
                <item.icon /><span>{item.label}</span><CommandShortcut>{index + 1}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
