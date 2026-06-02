import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { LoginForm } from "@/components/auth/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  const redirectTo = redirect && redirect.startsWith("/") ? redirect : "/dashboard";

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <Logo className="relative [&_span:last-child]:text-white" />
        <div className="relative space-y-4">
          <h2 className="text-3xl font-bold leading-tight">
            Votre assistant commercial WhatsApp, toujours actif.
          </h2>
          <p className="max-w-md text-sidebar-foreground/80">
            Connectez-vous pour suivre vos conversations, vos prospects chauds et la performance de
            votre agent IA.
          </p>
        </div>
        <p className="relative text-sm text-sidebar-muted">© {new Date().getFullYear()} FasoStock</p>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col items-center justify-center px-6 py-12">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>

          <div className="mb-6 space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight">Connexion admin</h1>
            <p className="text-sm text-muted-foreground">Accédez à votre tableau de bord FasoStock WhatsApp Agent.</p>
          </div>

          <LoginForm redirectTo={redirectTo} demoMode={!isSupabaseConfigured} />

          <Link
            href="/"
            className="mt-6 inline-flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
