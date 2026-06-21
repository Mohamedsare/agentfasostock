import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Bot,
  Check,
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

/** Everything is included in both billing periods — only the price changes. */
const PLAN_FEATURES = [
  "Agent WhatsApp IA disponible 24h/24",
  "Qualification & scoring automatiques",
  "Mini-CRM, conversations & statistiques",
  "Multi-agents & multi-numéros",
  "Équipe & invitations illimitées",
  "Alertes de relais en temps réel",
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <Link
              href="#pricing"
              className="mr-1 hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Tarifs
            </Link>
            <ThemeToggle />
            <Button asChild size="sm" className="sm:h-10 sm:px-4 sm:text-sm">
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
        {/* Image — hidden on mobile, visible from lg */}
        <Image
          src="/images/agfs-removebg-preview.png"
          alt=""
          fill
          className="hidden object-contain lg:block"
          style={{ objectPosition: "8% top" }}
          priority
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          {/* Mobile: centered. Desktop: pushed right to leave room for image */}
          <div className="mx-auto max-w-xl text-center lg:ml-[50%] lg:text-left">
            <Badge tone="primary" className="mx-auto mb-5 lg:mx-0">
              <Sparkles className="size-3.5" /> AgentFS · Agent WhatsApp IA
            </Badge>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
              Transformez vos messages WhatsApp en{" "}
              <span className="text-primary">clients qualifiés</span>
            </h1>
            <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
              Un assistant intelligent qui répond, qualifie et convertit vos prospects automatiquement —
              pendant que vous gérez votre commerce.
            </p>
            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:items-start lg:justify-start">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/signup">
                  Créer mon agent <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/login">Accéder au dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <Image
            src="/images/im2.png"
            alt="Aperçu du dashboard AgentFS"
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

      {/* Pricing */}
      <section id="pricing" className="relative overflow-hidden border-y border-border bg-muted/30">
        <div className="absolute -bottom-24 left-1/2 h-64 w-160 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <Badge tone="primary" className="mx-auto mb-4">
              <Sparkles className="size-3.5" /> Tarifs simples
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Un seul produit, deux façons de payer
            </h2>
            <p className="mt-3 text-muted-foreground">
              Toutes les fonctionnalités incluses, sans limite. Passez à l&apos;annuel et économisez
              2 mois.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl items-stretch gap-6 sm:grid-cols-2">
            {/* Monthly */}
            <div className="flex flex-col rounded-3xl border border-border bg-card p-8 shadow-sm">
              <h3 className="text-lg font-semibold">Mensuel</h3>
              <p className="mt-1 text-sm text-muted-foreground">Sans engagement</p>
              <div className="mt-5 flex items-end gap-1.5">
                <span className="text-4xl font-bold tracking-tight">12 000</span>
                <span className="mb-1 text-sm font-medium text-muted-foreground">CFA / mois</span>
              </div>
              <ul className="mt-6 space-y-3">
                {PLAN_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" size="lg" className="mt-8 w-full">
                <Link href="/signup">Commencer</Link>
              </Button>
            </div>

            {/* Annual — highlighted */}
            <div className="relative flex flex-col rounded-3xl border-2 border-primary bg-card p-8 shadow-lg shadow-primary/10">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
                Recommandé · 2 mois offerts
              </span>
              <h3 className="text-lg font-semibold">Annuel</h3>
              <p className="mt-1 text-sm text-muted-foreground">Le meilleur rapport qualité-prix</p>
              <div className="mt-5 flex items-end gap-1.5">
                <span className="text-4xl font-bold tracking-tight">120 000</span>
                <span className="mb-1 text-sm font-medium text-muted-foreground">CFA / an</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-primary">
                soit 10 000 CFA/mois — économisez 24 000 CFA
              </p>
              <ul className="mt-6 space-y-3">
                {PLAN_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="mt-8 w-full">
                <Link href="/signup">
                  Choisir l&apos;annuel <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          <p className="mx-auto mt-8 max-w-xl text-center text-xs text-muted-foreground">
            Prix en francs CFA (XOF), toutes taxes comprises. Résiliable à tout moment.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pt-28">
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
          <p>© {new Date().getFullYear()} AgentFS — Agent WhatsApp IA</p>
        </div>
      </footer>
    </div>
  );
}
