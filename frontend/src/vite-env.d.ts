/// <reference types="vite/client" />

/**
 * Build-time configuration, declared so the compiler checks these rather than
 * letting a typo resolve to `any` and silently disable the feature it gates.
 *
 * Both are optional — an unset value is the normal local-development case.
 */
interface ImportMetaEnv {
  /** 'true' turns on the fixture-backed demo backend (see src/demo/). Set on
   *  the Vercel deployment, which has no API behind it. A string, not a
   *  boolean: Vite inlines env values verbatim. */
  readonly VITE_DEMO_MODE?: string
  /** Repository the demo banner's "Source" link points at. */
  readonly VITE_REPO_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
