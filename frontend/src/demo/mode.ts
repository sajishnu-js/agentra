/**
 * The demo flag, alone in its own module.
 *
 * Kept separate from `demo/server.ts` on purpose: `api.ts` needs the flag
 * synchronously to decide whether to take the demo branch, while `server.ts`
 * imports `ApiError` back from `api.ts`. Importing the flag from `server.ts`
 * would therefore close an import cycle. This file imports nothing, so it
 * cannot.
 *
 * Compared against the string 'true' rather than coerced to a boolean: Vite
 * inlines env values as string literals, and the literal 'false' is truthy.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'
