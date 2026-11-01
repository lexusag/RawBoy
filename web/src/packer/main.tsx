import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PackerApp } from './PackerApp';
import '../styles.css';
import './packer.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PackerApp />
  </StrictMode>,
);
