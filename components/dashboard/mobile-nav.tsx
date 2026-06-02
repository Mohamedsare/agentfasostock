"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Logo } from "@/components/logo";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { Button } from "@/components/ui/button";

/** Slide-in sidebar drawer for small screens. */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
          <Menu className="size-5" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-16 items-center border-b border-sidebar-border px-5 text-white">
            <Logo />
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
