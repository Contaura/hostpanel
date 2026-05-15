import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import './index.css';

axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401
        && !err.config?.url?.includes('/api/auth/')
        && !err.config?.url?.includes('/api/portal/')) {
      // Clear every auth-derived key together — leaving hp_user / hp_role
      // behind makes a stale username/role flash in the UI on the next load.
      localStorage.removeItem('hp_token');
      localStorage.removeItem('hp_user');
      localStorage.removeItem('hp_role');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
