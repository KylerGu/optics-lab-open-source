import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './uiFonts';
import './styles.css';
import './workbench.css';
import './gaussian-scene.css';
import 'katex/dist/katex.min.css';
import './readability.css';
import './spatial-build.css';
import './ui-consistency.css';
import './type-scale.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
