import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createDemoApi, liveBoardConfig } from './api.ts';
import './styles.css';

const root = document.getElementById('message-board-root');
if (!root) throw new Error('Message board root is missing');

// Local development uses a Vite proxy for the public demo's exact-origin grant.
const api = createDemoApi({ ...liveBoardConfig,
  apiOrigin: import.meta.env.DEV ? '/message-board-api' : liveBoardConfig.apiOrigin,
});
createRoot(root).render(<App api={api} />);
