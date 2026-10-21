"use client";

import { type Dispatch, type SetStateAction, useState } from "react";

/**
 * State seeded from a prop that follows the prop afterwards. `useState(prop)` copies the prop
 * once, so a `router.refresh()` that brings a new server value would leave the old one on screen.
 * Here the local value is replaced whenever the prop changes (the "adjust state while rendering"
 * pattern of the React docs) and may be set locally in between, for example after a save.
 */
export function useSyncedState<T>(prop: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(prop);
  const [seen, setSeen] = useState(prop);
  if (!Object.is(seen, prop)) {
    setSeen(prop);
    setValue(prop);
  }
  return [value, setValue];
}
