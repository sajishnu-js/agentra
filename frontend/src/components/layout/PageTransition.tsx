import { useLocation, useOutlet } from 'react-router-dom'

/**
 * Replays a quick fade + settle-in whenever the matched route changes.
 *
 * `useOutlet()` + keying by pathname, rather than wrapping `<Routes>` itself:
 * that would remount the whole AppShell — Sidebar, Topbar, and the WebGL
 * AmbientScene — on every inner navigation, tearing down and recreating a
 * GPU context just to switch pages. This only re-triggers the animation on
 * the routed page content; the shell around it never remounts.
 */
export function PageTransition() {
  const location = useLocation()
  const outlet = useOutlet()

  return (
    // h-full/min-h-0: without a bounded height here, a page whose own layout
    // depends on h-full (e.g. Conversations' three-pane grid, or a page with
    // an internally-scrolling middle column) resolves h-full against this
    // div's *auto* height instead of <main>'s real available space — the
    // page just grows as tall as its content and <main>'s own
    // overflow-y-auto ends up scrolling everything as one block instead of
    // letting the page manage its own internal scroll regions. Harmless for
    // ordinary pages that grow taller than the viewport: with no explicit
    // overflow set here, their content still overflows visibly and <main>
    // still scrolls it exactly as before.
    <div
      key={location.pathname}
      className="h-full min-h-0 animate-in fade-in-0 zoom-in-95 duration-200 ease-out"
    >
      {outlet}
    </div>
  )
}
