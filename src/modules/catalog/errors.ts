/**
 * Catalog errors. Every refusal of a catalog read is `404 NOT_FOUND` with the default message
 * and empty `details`, whatever the reason: a slug that matches nothing, a product hidden by any
 * of the five conditions of BR-05, a suspended store, a store whose owner is deactivated, and an
 * inactive category are answered alike (docs/API_CONTRACTS.md sections 1.8 and 3.4), so the
 * answer never says that a hidden row exists.
 */
import { type AppError, notFound } from "@/server/errors";

export function catalogNotFound(): AppError {
  return notFound();
}
