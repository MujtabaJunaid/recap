import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Meetings } from './routes/Meetings'
import { MeetingDetail } from './routes/MeetingDetail'
import { Search } from './routes/Search'
import { Actions } from './routes/Actions'
import { HighlightsFeed } from './routes/HighlightsFeed'
import { SharedClipPage } from './routes/SharedClipPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/share/:clipId" element={<SharedClipPage />} />
        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route path="/" element={<Meetings />} />
                <Route path="/m/:id" element={<MeetingDetail />} />
                <Route path="/search" element={<Search />} />
                <Route path="/actions" element={<Actions />} />
                <Route path="/highlights" element={<HighlightsFeed />} />
                <Route path="*" element={<Meetings />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>
    </>
  )
}
