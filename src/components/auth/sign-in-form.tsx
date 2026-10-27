"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { th } from "@/i18n/th";
import { apiErrorMessage } from "@/lib/api-client/error-copy";
import { signIn } from "@/lib/api-client/auth";
import { SIGN_IN_NEXT_PARAM, ROUTES } from "@/lib/routes";
import {
  type FieldErrors,
  type SignInField,
  SIGN_IN_FIELDS,
  serverFieldErrors,
  validateSignIn,
  authFieldMessage,
} from "./validation";

/**
 * Sign-in form (REQ-C-02). `next` is a same-origin path the server page already validated; it is
 * only used after the server accepted the sign-in. A wrong email and a wrong password get the
 * same message.
 */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignInField>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || done) return;
    setMessage(null);
    const result = validateSignIn(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await signIn(result.body);
    setPending(false);
    if (response.ok) {
      setDone(true);
      router.replace(next);
      router.refresh();
      return;
    }
    if (response.status === 401) {
      setMessage(th.auth.invalidCredentials);
    } else if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, SIGN_IN_FIELDS, authFieldMessage);
      setErrors(mapped.errors);
      setMessage(mapped.unplaced ? th.auth.formInvalid : null);
    } else {
      setMessage(apiErrorMessage(response));
    }
  }

  return (
    <Card padding="panel" className="w-full max-w-md">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {message ? <Alert tone="danger">{message}</Alert> : null}
        {done ? <Alert tone="success">{th.auth.signedIn}</Alert> : null}
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
          autoComplete="current-password"
          value={values.password}
          onChange={(event) =>
            setValues((previous) => ({ ...previous, password: event.target.value }))
          }
          errorText={errors.password}
          required
          disabled={pending}
        />
        <Button type="submit" loading={pending} disabled={done} fullWidth>
          {th.auth.signInSubmit}
        </Button>
      </form>
      <p className="type-small text-foreground-secondary mt-4">
        {th.auth.noAccount}{" "}
        <Link
          href={`${ROUTES.signUp}?${SIGN_IN_NEXT_PARAM}=${encodeURIComponent(next)}`}
          className="focus-ring rounded-sm underline underline-offset-4"
        >
          {th.auth.signUpSubmit}
        </Link>
      </p>
    </Card>
  );
}
