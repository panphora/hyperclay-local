import React from 'react';
import { createRoot } from 'react-dom/client';
import PopoverApp from './PopoverApp.jsx';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<PopoverApp />);
