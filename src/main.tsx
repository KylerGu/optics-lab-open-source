import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { LandingGate } from './Landing';
import './uiFonts';

// 立即开始加载主应用；引导页显示期间它会在后台下载完成。
const appModule = import('./AppEntry');
const App = lazy(() => appModule);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LandingGate><Suspense fallback={null}><App /></Suspense></LandingGate>
  </React.StrictMode>,
);
