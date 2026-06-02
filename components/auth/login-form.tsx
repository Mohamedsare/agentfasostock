"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, LogIn } from "lucide-react";
import { signIn, type AuthState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
      Se connecter
    </Button>
  );
}

export function LoginForm({ redirectTo, demoMode }: { redirectTo: string; demoMode: boolean }) {
  const [state, formAction] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirect" value={redirectTo} />

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="vous@fasostock.com" autoComplete="email" required={!demoMode} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required={!demoMode} />
      </div>

      {state.error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </div>
      )}

      <SubmitButton />

      {demoMode && (
        <p className="text-center text-xs text-muted-foreground">
          Mode démo : Supabase n'est pas configuré, vous entrerez directement dans le dashboard.
        </p>
      )}
    </form>
  );
}
