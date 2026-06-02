import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Bot,
  Flame,
  LineChart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  { icon: MessageCircle, title: "Réponses WhatsApp automatiques", desc: "L'IA accueille, qualifie et répond aux prospects 24h/24 via Wasender." },
  { icon: Flame, title: "Scoring & qualification", desc: "Chaque prospect est noté sur 100 et catégorisé selon son niveau d'intérêt." },
  { icon: Bot, title: "Agent configurable", desc: "Ton, prompt, mode support ou prospection, base de connaissance — tout est paramétrable." },
  { icon: Users, title: "Mini-CRM complet", desc: "Conversations, prospects, clients qualifiés et support dans une seule interface." },
  { icon: LineChart, title: "Statistiques claires", desc: "Suivez conversions, prospects chauds et performance de l'IA en un coup d'œil." },
  { icon: ShieldCheck, title: "Relances & alertes", desc: "Relances automatiques et emails dès qu'un prospect devient qualifié." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/login">
                Connexion <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="absolute -top-32 left-1/2 h-72 w-160 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <Badge tone="primary" className="mx-auto mb-5">
            <Sparkles className="size-3.5" /> Agent WhatsApp IA pour FasoStock
          </Badge>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Transformez vos messages WhatsApp en{" "}
            <span className="text-primary">clients qualifiés</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
            Un assistant intelligent qui répond, qualifie et convertit vos prospects automatiquement —
            pendant que vous gérez votre commerce.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/login">
                Accéder au dashboard <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#features">Découvrir les fonctionnalités</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <Image
            src="/images/im2.png"
            alt="Aperçu du dashboard FasoStock WhatsApp Agent"
            width={1086}
            height={1448}
            className="h-auto w-full"
            priority
          />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Un mini-CRM intelligent, pas un simple chatbot</h2>
          <p className="mt-3 text-muted-foreground">
            Tout ce dont vous avez besoin pour gérer support, prospection et conversion depuis WhatsApp.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
          <div className="absolute -right-16 -top-16 size-56 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <h2 className="text-balance text-3xl font-bold sm:text-4xl">Prêt à automatiser votre prospection ?</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/90">
            Connectez votre WhatsApp, laissez l'IA travailler et reprenez la main quand vous le souhaitez.
          </p>
          <Button asChild size="lg" variant="secondary" className="mt-7">
            <Link href="/login">
              Ouvrir le dashboard <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} FasoStock — Agent WhatsApp IA</p>
        </div>
      </footer>
    </div>
  );
}
