"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, KeyRound, CheckCircle2, AlertCircle } from "lucide-react";
import { updatePassword, type ProfileState } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
      Changer le mot de passe
    </Button>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<ProfileState, FormData>(updatePassword, {});

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current">Mot de passe actuel</Label>
        <Input id="current" name="current" type="password" placeholder="••••••••" autoComplete="current-password" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input id="password" name="password" type="password" placeholder="••••••••" autoComplete="new-password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmer</Label>
          <Input id="confirm" name="confirm" type="password" placeholder="••••••••" autoComplete="new-password" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Minimum 8 caractères.</p>

      {state.error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" />
          Mot de passe modifié avec succès.
        </div>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
