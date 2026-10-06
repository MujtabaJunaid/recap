import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Shell } from './components/Shell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Meetings } from './routes/Meetings'
import { MeetingDetail } from './routes/MeetingDetail'
import { Search } from './routes/Search'
import { Actions } from './routes/Actions'
import { HighlightsFeed } from './routes/HighlightsFeed'
import { SharedClipPage } from './routes/SharedClipPage'
import { SignIn } from './routes/SignIn'
import { Record } from './routes/Record'
import { JoinCall } from './routes/JoinCall'
import { Ask } from './routes/Ask'
import { SavedMeeting } from './routes/SavedMeeting'
import { SessionProvider, useSession } from './state/session'
import { WorkspaceProvider } from './state/workspace'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/**
 * Remounts on every meeting change. Without the key, React reuses the instance across
 * /m/a -> /m/b and the previous meeting's playhead, template and tab leak into the next.
 */
function MeetingRoute() {
  const { id } = useParams()
  return <MeetingDetail key={id} id={id} />
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const location = useLocation()

  if (status === 'loading') return null
  if (status === 'anonymous') {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />
  }
  return <>{children}</>
}

function WorkspaceRoutes() {
  return (
    <RequireSession>
      <Shell>
        <Routes>
          <Route path="/" element={<Meetings />} />
          <Route path="/m/:id" element={<MeetingRoute />} />
          <Route path="/search" element={<Search />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/join" element={<JoinCall />} />
          <Route path="/record" element={<Record />} />
          <Route path="/call/:id" element={<SavedMeeting />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/highlights" element={<HighlightsFeed />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </RequireSession>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <WorkspaceProvider>
          <ScrollToTop />
          <Routes>
            {/* Public by design: a clip recipient has no account. */}
            <Route path="/share/:clipId" element={<SharedClipPage />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="*" element={<WorkspaceRoutes />} />
          </Routes>
        </WorkspaceProvider>
      </SessionProvider>
    </ErrorBoundary>
  )
}
