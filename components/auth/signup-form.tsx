"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, MailCheck, UserPlus } from "lucide-react";
import { signUp, type AuthState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      Créer mon compte
    </Button>
  );
}

export function SignupForm({ demoMode }: { demoMode: boolean }) {
  const [state, formAction] = useActionState<AuthState, FormData>(signUp, {});

  // Confirmation email sent — no session yet. Show a clear "check your inbox" state.
  if (state.emailSent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-7 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Vérifiez votre boîte mail 📩</h2>
          <p className="text-sm text-muted-foreground">
            Nous avons envoyé un lien de confirmation
            {state.email ? (
              <>
                {" "}à <span className="font-medium text-foreground">{state.email}</span>
              </>
            ) : null}
            . Cliquez sur le lien pour activer votre compte, puis vous pourrez vous connecter.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Pensez à regarder dans vos spams. Le lien peut prendre une minute à arriver.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Nom complet</Label>
        <Input id="fullName" name="fullName" placeholder="Votre nom" autoComplete="name" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="vous@entreprise.com" autoComplete="email" required={!demoMode} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" placeholder="8 caractères minimum" autoComplete="new-password" required={!demoMode} />
      </div>

      {state.error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
