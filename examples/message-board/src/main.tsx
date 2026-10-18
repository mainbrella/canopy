import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createDemoApi, liveBoardConfig } from './api.ts';
import { localDemoConfig } from './config.ts';
import './styles.css';

const root = document.getElementById('message-board-root');
if (!root) throw new Error('Message board root is missing');

// The default development server proxies to the public demo; local-api mode
// uses a local backend and its separate project/key.
const api = createDemoApi(import.meta.env.MODE === 'local-api'
  ? { ...localDemoConfig, apiOrigin: import.meta.env.DEV ? '/message-board-api' : localDemoConfig.apiOrigin }
  : { ...liveBoardConfig, apiOrigin: import.meta.env.DEV ? '/message-board-api' : liveBoardConfig.apiOrigin });
createRoot(root).render(<App api={api} />);
