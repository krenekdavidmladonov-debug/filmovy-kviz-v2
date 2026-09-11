import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { AuthProvider } from './auth/AuthProvider';
import { productConfig } from './config/product';
import './styles/global.css';
import './styles/editor.css';

const rootElement = document.getElementById('root');
const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');

document.title = productConfig.adminLabel;
description?.setAttribute('content', `${productConfig.adminLabel} pro přípravu a moderování kvízů.`);

if (!rootElement) {
  throw new Error('Root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
