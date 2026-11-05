// src/hooks/use-hydrated.ts
// False in the server-rendered HTML and until React hydrates, true after.
//
// TanStack Router exports `useHydrated` from its index but marks it
// `@internal` in ClientOnly.js. Every caller imports it from here, so a
// TanStack upgrade that moves or renames it needs one fix, in this file.
export { useHydrated } from '@tanstack/react-router'
