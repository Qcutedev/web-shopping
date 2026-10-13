"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input";
import { UserName } from "@/components/user-name";
import { th } from "@/i18n/th";
import type { ApiFailure } from "@/lib/api-client/http";
import { updateProfile } from "@/lib/api-client/me";
import { ROUTES } from "@/lib/routes";
import type { ProfileDto } from "@/modules/profile/schema";
import { RequestError } from "./request-error";
import {
  type FieldErrors,
  type ProfileField,
  profileServerMessage,
  serverFieldErrors,
  validateProfileForm,
} from "./validation";

export type ProfileView = Pick<ProfileDto, "name" | "email" | "phone">;

const FIELDS: readonly ProfileField[] = ["name", "phone"];

/**
 * Profile view with an edit form (REQ-C-03). Only `name` and `phone` can change; the email is
 * shown and never editable. The server's answer is shown after a save, and the server is the
 * judge of every value.
 */
export function ProfileCard({ profile }: { profile: ProfileView }) {
  const router = useRouter();
  const [current, setCurrent] = useState<ProfileView>(profile);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [errors, setErrors] = useState<FieldErrors<ProfileField>>({});
  const [failure, setFailure] = useState<Pick<ApiFailure, "status" | "code"> | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Keyboard users: focus moves into the form when it opens and back to the edit button when it
  // closes.
  useEffect(() => {
    if (editing) nameRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function startEditing() {
    setName(current.name);
    setPhone(current.phone ?? "");
    setErrors({});
    setFailure(null);
    setFormMessage(null);
    setSaved(false);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setFormMessage(null);
    const result = validateProfileForm({ name, phone });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const response = await updateProfile(result.body);
    setPending(false);
    if (response.ok) {
      setCurrent({
        name: response.data.name,
        email: response.data.email,
        phone: response.data.phone,
      });
      setEditing(false);
      setSaved(true);
      router.refresh();
      return;
    }
    if (response.code === "VALIDATION_ERROR") {
      const mapped = serverFieldErrors(response.fields, FIELDS, profileServerMessage);
      setErrors(mapped.errors);
      if (mapped.unplaced) setFormMessage(th.account.formInvalid);
      return;
    }
    setFailure(response);
  }

  return (
    <Card as="section" padding="panel" aria-labelledby="profile-card-title">
      <CardTitle as="h2" size="panel" id="profile-card-title">
        {editing ? th.account.profile.formTitle : th.account.profile.title}
      </CardTitle>

      {saved ? (
        <Alert tone="success" className="mt-4">
          {th.account.profile.saved}
        </Alert>
      ) : null}

      {editing ? (
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          {failure ? <RequestError failure={failure} returnTo={ROUTES.account} /> : null}
          {formMessage ? <Alert tone="danger">{formMessage}</Alert> : null}
          <InputField
            ref={nameRef}
            label={th.account.profile.name}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            errorText={errors.name}
            autoComplete="name"
            required
            disabled={pending}
          />
          <InputField
            label={th.account.profile.phone}
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            helperText={th.account.profile.phoneHelper}
            errorText={errors.phone}
            autoComplete="tel"
            disabled={pending}
          />
          <p className="type-small text-foreground-muted">
            {th.account.profile.email}: {current.email} ({th.account.profile.emailNote})
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={pending}>
              {th.account.common.save}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setErrors({});
                setFailure(null);
                setFormMessage(null);
              }}
            >
              {th.account.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
            <dt className="type-label text-foreground-secondary">{th.account.profile.name}</dt>
            <dd>
              <UserName>{current.name}</UserName>
            </dd>
            <dt className="type-label text-foreground-secondary">{th.account.profile.email}</dt>
            <dd className="min-w-0 break-words">
              {current.email}
              <span className="type-small text-foreground-muted block">
                {th.account.profile.emailNote}
              </span>
            </dd>
            <dt className="type-label text-foreground-secondary">{th.account.profile.phone}</dt>
            <dd>
              {current.phone === null ? (
                <span className="text-foreground-muted">{th.account.common.notProvided}</span>
              ) : (
                current.phone
              )}
            </dd>
          </dl>
          <div className="mt-6">
            <Button ref={editRef} variant="secondary" onClick={startEditing}>
              {th.account.profile.edit}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
