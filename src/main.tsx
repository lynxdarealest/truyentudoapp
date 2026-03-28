import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { initClientErrorMonitoring } from './errorMonitoring';

const App = lazy(() => import('./App.tsx'));
const Phase0DemoApp = lazy(() => import('./phase0/Phase0DemoApp.tsx'));
const Phase1App = lazy(() => import('./phase1/Phase1App.tsx'));
const Phase2App = lazy(() => import('./phase2/Phase2App.tsx'));
const Phase3App = lazy(() => import('./phase3/Phase3App.tsx'));
const Phase4App = lazy(() => import('./phase4/Phase4App.tsx'));
const Phase5App = lazy(() => import('./phase5/Phase5App.tsx'));

if (typeof window !== 'undefined' && /^\/{2,}/.test(window.location.pathname)) {
  const normalizedPath = `/${window.location.pathname.replace(/^\/+/, '')}`;
  const normalizedUrl = `${window.location.origin}${normalizedPath}${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', normalizedUrl);
}

initClientErrorMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense
      fallback={(
        <div className="min-h-screen flex items-center justify-center bg-[#F6F7F4] text-[#1F2933]">
          <div className="rounded-xl border border-[#D9E2EC] bg-white px-4 py-3 text-sm font-semibold">
            Loading workspace...
          </div>
        </div>
      )}
    >
      {(() => {
        const query = new URLSearchParams(window.location.search);
        if (query.get('phase5') === '1') return <Phase5App />;
        if (query.get('phase4') === '1') return <Phase4App />;
        if (query.get('phase3') === '1') return <Phase3App />;
        if (query.get('phase2') === '1') return <Phase2App />;
        if (query.get('phase1') === '1') return <Phase1App />;
        if (query.get('phase0') === '1') return <Phase0DemoApp />;
        return (
          <BrowserRouter>
            <App />
          </BrowserRouter>
        );
      })()}
    </Suspense>
  </StrictMode>,
);
