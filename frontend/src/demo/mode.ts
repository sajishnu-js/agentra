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
 *
 * `PROD` is the default rather than `false`, which is the important part. A
 * production build is only ever served from static hosting with no API behind
 * it, so defaulting to "off" meant one forgotten environment variable sent
 * every request to a backend that isn't there — `/auth/me` 404s, the session
 * resolves to signed-out, and the whole site becomes a sign-in wall. Defaulting
 * to "on" makes the deployable build work on its own, and a real backend
 * deployment opts out explicitly with VITE_DEMO_MODE=false.
 *
 * `npm run dev` is unaffected: PROD is false there, so local development still
 * talks to the real FastAPI backend.
 */
export const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === undefined || import.meta.env.VITE_DEMO_MODE === ''
    ? import.meta.env.PROD
    : import.meta.env.VITE_DEMO_MODE === 'true'
