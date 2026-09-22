import {
  Bot,
  BookOpen,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Settings2,
  Ticket,
  Workflow,
} from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'

import { PageTransition } from '@/components/layout/PageTransition'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { DemoBanner } from '@/demo/DemoBanner'

// three.js + fiber/drei are ~450 kB gzipped — split into their own chunk so
// the app shell paints before that downloads, rather than blocking on it.
const AmbientScene = lazy(() =>
  import('@/scene/AmbientScene').then((m) => ({ default: m.AmbientScene })),
)

/** Route → header copy. Kept here so pages stay presentational. The icon
 *  mirrors the Sidebar's nav icon for the same route — the header then
 *  reads as "you are here", not just a page-title label. */
const pageMeta: Record<string, { title: string; subtitle: string; icon: typeof LayoutDashboard }> = {
  '/app': {
    title: 'Home',
    subtitle: 'Request volume and when the load lands',
    icon: LayoutDashboard,
  },
  '/app/agents': {
    title: 'Agents',
    subtitle: 'Configure the AI agents answering customers',
    icon: Bot,
  },
  '/app/knowledge-base': {
    title: 'Knowledge Base',
    subtitle: 'Documents your agents retrieve answers from',
    icon: BookOpen,
  },
  '/app/requests': {
    title: 'Requests Hub',
    subtitle: 'Handoffs and approvals waiting on a human',
    icon: Ticket,
  },
  '/app/workflows': {
    title: 'Workflow',
    subtitle: 'Automations that run when something happens',
    icon: Workflow,
  },
  '/app/inboxes': { title: 'Inboxes', subtitle: 'Connected channels', icon: Inbox },
  '/app/conversations': {
    title: 'Conversations',
    subtitle: 'Every thread across WhatsApp and Telegram',
    icon: MessagesSquare,
  },
}

export function AppShell() {
  const { pathname } = useLocation()
  // /app/agents/:agentId isn't a fixed key pageMeta can list — its own page
  // header already names the specific agent, so the Topbar just needs to
  // say what kind of page this is rather than duplicating that lookup here.
  const isAgentConfigRoute = /^\/app\/agents\/[^/]+$/.test(pathname)
  const isSettingsRoute = pathname.startsWith('/app/settings')
  // /app/conversations/:conversationId — a search result or a notification's
  // deep link into one specific thread. Same page as the bare route, just a
  // pathname pageMeta's exact-match lookup won't recognise on its own.
  const isConversationRoute = /^\/app\/conversations(\/[^/]+)?$/.test(pathname)
  // /app/workflows/:workflowId — the builder names the specific workflow in
  // its own toolbar, so the header only says what kind of page this is.
  const isWorkflowBuilderRoute = /^\/app\/workflows\/[^/]+$/.test(pathname)
  const meta = isAgentConfigRoute
    ? {
        title: 'Agent Configuration',
        subtitle: 'Prompt, guardrails, knowledge and behaviour for this agent',
        icon: Settings2,
      }
    : isSettingsRoute
      ? {
          title: 'Settings',
          subtitle: 'Profile, workspace, security and everything in between',
          icon: Settings2,
        }
      : isConversationRoute
        ? pageMeta['/app/conversations']
        : isWorkflowBuilderRoute
          ? {
              title: 'Workflow Builder',
              subtitle: 'Triggers, conditions and actions on one canvas',
              icon: Workflow,
            }
          : (pageMeta[pathname] ?? { title: 'Agentra', subtitle: '', icon: LayoutDashboard })

  return (
    <>
      <Suspense fallback={null}>
        <AmbientScene />
      </Suspense>
      {/* Column wrapper so the demo notice can sit above the shell without
          the sidebar and main area losing their full height. Renders as a
          single flex-1 child (i.e. no visual change at all) outside the
          demo build, where DemoBanner returns null. */}
      <div className="flex h-full flex-col">
        <DemoBanner />
        <div className="flex min-h-0 flex-1 gap-4 p-4 lg:gap-5 lg:p-5">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Topbar title={meta.title} subtitle={meta.subtitle} icon={meta.icon} />
            <main className="min-h-0 flex-1 overflow-y-auto pb-1">
              <PageTransition />
            </main>
          </div>
        </div>
      </div>
    </>
  )
}
