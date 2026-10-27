"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { th } from "@/i18n/th";
import { readSession, signUp } from "@/lib/api-client/auth";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import { ROUTES, signInHref } from "@/lib/routes";
import {
  authFieldMessage,
  type FieldErrors,
  SIGN_UP_FIELDS,
  type SignUpField,
  serverFieldErrors,
  validateSignUp,
} from "./validation";

/**
 * Sign-up form (REQ-C-01). The server answers the same for a new email and for one that already
 * has an account, so the form asks for the session next (API_CONTRACTS 5.1): an actor means the
 * account is signed in; none means a generic message that does not say the email exists.
 */
export function SignUpForm({ next }: { next: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignUpField>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || done) return;
    setMessage(null);
    const result = validateSignUp(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await signUp(result.body);
    if (!response.ok) {
      setPending(false);
      if (response.code === "VALIDATION_ERROR") {
        const mapped = serverFieldErrors(response.fields, SIGN_UP_FIELDS, authFieldMessage);
        setErrors(mapped.errors);
        setMessage(mapped.unplaced ? th.auth.formInvalid : null);
      } else {
        setMessage(apiErrorMessage(response));
      }
      return;
    }
    const session = await readSession();
    setPending(false);
    if (session.ok && session.data !== null) {
      setDone(true);
      router.replace(next);
      router.refresh();
      return;
    }
    setMessage(session.ok ? th.auth.signUpNotCompleted : apiErrorMessage(session));
  }

  return (
    <Card padding="panel" className="w-full max-w-md">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {message ? <Alert tone="danger">{message}</Alert> : null}
        {done ? <Alert tone="success">{th.auth.signedUp}</Alert> : null}
        <InputField
          label={th.auth.name}
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(event) => setValues((previous) => ({ ...previous, name: event.target.value }))}
          errorText={errors.name}
          required
          disabled={pending}
        />
        <InputField
          label={th.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, email: event.target.value }))
          }
          errorText={errors.email}
          required
          disabled={pending}
        />
        <InputField
          label={th.auth.password}
          name="password"
          type="password"
          autoComplete="new-password"
          helperText={th.auth.passwordHelper}
          value={values.password}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, password: event.target.value }))
          }
          errorText={errors.password}
          required
          disabled={pending}
        />
        <Button type="submit" loading={pending} disabled={done} fullWidth>
          {th.auth.signUpSubmit}
        </Button>
      </form>
      <p className="type-small text-foreground-secondary mt-4">
        {th.auth.haveAccount}{" "}
        <Link
          href={next === ROUTES.home ? ROUTES.signIn : signInHref(next)}
          className="focus-ring rounded-sm underline underline-offset-4"
        >
          {th.auth.signInSubmit}
        </Link>
      </p>
    </Card>
  );
}
