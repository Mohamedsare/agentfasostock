import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { SignupForm } from "@/components/auth/signup-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <Logo className="relative [&_span:last-child]:text-white" />
        <div className="relative space-y-4">
          <h2 className="text-3xl font-bold leading-tight">
            Lancez votre propre agent WhatsApp IA.
          </h2>
          <p className="max-w-md text-sidebar-foreground/80">
            Créez votre compte, configurez votre agent, connectez votre numéro WhatsApp et laissez
            l&apos;IA qualifier vos prospects.
          </p>
        </div>
        <p className="relative text-sm text-sidebar-muted">© {new Date().getFullYear()} AgentFS</p>
      </div>

      <div className="relative flex flex-col items-center justify-center px-6 py-12">
        <Link
          href="/"
          className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Accueil
        </Link>
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>

          <div className="mb-6 space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Créer un compte</h1>
            <p className="text-sm text-muted-foreground">Quelques secondes pour démarrer.</p>
          </div>

          <SignupForm demoMode={!isSupabaseConfigured} />

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
