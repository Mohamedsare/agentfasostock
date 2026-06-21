import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile/profile-form";
import { PasswordForm } from "@/components/profile/password-form";
import { UserCircle, Lock } from "lucide-react";

export const metadata: Metadata = { title: "Mon profil" };

export default async function ProfilePage() {
  const user = await getSessionUser();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mon profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gérez vos informations personnelles et votre sécurité.
        </p>
      </div>

      {/* Infos générales */}
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <UserCircle className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Informations personnelles</h2>
            <p className="text-xs text-muted-foreground">Nom et adresse email</p>
          </div>
        </div>
        <ProfileForm name={user.name} email={user.email} />
      </section>

      {/* Mot de passe */}
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Lock className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Mot de passe</h2>
            <p className="text-xs text-muted-foreground">Modifiez votre mot de passe de connexion</p>
          </div>
        </div>
        <PasswordForm />
      </section>
    </div>
  );
}
