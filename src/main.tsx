import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './workbench.css';
import './gaussian-scene.css';
import 'katex/dist/katex.min.css';
import './readability.css';
import './spatial-build.css';
import './ui-consistency.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
