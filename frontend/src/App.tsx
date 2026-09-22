import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'

import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { ThemeSync } from '@/auth/ThemeSync'
import { AppShell } from '@/components/layout/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentConfig } from '@/pages/AgentConfig'
import { Agents } from '@/pages/Agents'
import { Conversations } from '@/pages/Conversations'
import { Home } from '@/pages/Home'
import { Inboxes } from '@/pages/Inboxes'
import { KnowledgeBase } from '@/pages/KnowledgeBase'
import { Landing } from '@/pages/Landing'
// PREVIEW ONLY — landing-page design explorations, reachable at /preview.
// The live landing page above is untouched; deleting these two imports, the
// routes below, and src/pages/landing-previews/ removes the experiment.
import { LandingPreviews } from '@/pages/landing-previews'
import { RequestsHub } from '@/pages/RequestsHub'
import { Settings } from '@/pages/Settings'
import { SignIn } from '@/pages/SignIn'
import { WorkflowBuilder } from '@/pages/WorkflowBuilder'
import { Workflows } from '@/pages/Workflows'
import { ThemeProvider } from '@/theme/ThemeProvider'

/**
 * Gates the whole `/app` tree on a valid session. `status === 'loading'`
 * covers the brief window where a stored token is being checked against
 * /auth/me — rendering nothing rather than flashing the sign-in screen and
 * then immediately replacing it once the token turns out to be valid.
 */
function RequireAuth() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="glow-pulse size-8 rounded-full bg-brand opacity-60" />
      </div>
    )
  }

  if (status === 'signed-out') {
    return <SignIn />
  }

  return <AppShell />
}

/**
 * "Agents config, Knowledge Base... only Super Admin and Admin" — the same
 * boundary the API enforces independently via `require_staff`
 * (agents/router.py, knowledge_base/router.py); this is just so a regular
 * agent-role user gets bounced home instead of a page full of 403s.
 */
function RequireStaff() {
  const { user } = useAuth()
  const isStaff = user?.role === 'super_admin' || user?.role === 'admin'
  return isStaff ? <Outlet /> : <Navigate to="/app" replace />
}

function Routed() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      {/* Reachable directly even when Login Requirement is off — "keep the
          login page available, just not forced on everyone by default." */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/preview/*" element={<LandingPreviews />} />
      <Route path="/app" element={<RequireAuth />}>
        <Route index element={<Home />} />
        <Route element={<RequireStaff />}>
          <Route path="agents" element={<Agents />} />
          <Route path="agents/:agentId" element={<AgentConfig />} />
          <Route path="knowledge-base" element={<KnowledgeBase />} />
          <Route path="workflows" element={<Workflows />} />
          <Route path="workflows/:workflowId" element={<WorkflowBuilder />} />
        </Route>
        <Route path="requests" element={<RequestsHub />} />
        <Route path="inboxes" element={<Inboxes />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="conversations/:conversationId" element={<Conversations />} />
        <Route path="settings/*" element={<Settings />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      {/* App-wide, not just AppShell: Landing also uses Tooltip (ThemeToggle)
          now, and nesting a second TooltipProvider inside AppShell would be
          redundant rather than wrong — hoisting it here means any future
          page gets tooltip support for free instead of crashing on mount. */}
      <TooltipProvider>
        <BrowserRouter>
          <AuthProvider>
            <ThemeSync />
            <Routed />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  )
}
