import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App';
import './index.css';

axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/api/auth/')) {
      localStorage.removeItem('hp_token');
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
