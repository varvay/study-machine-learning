// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import notesWriter from './src/integrations/notes-writer.ts';

// https://astro.build/config
export default defineConfig({
  site: 'https://varvay.github.io',
  base: '/ai',
  integrations: [react(), notesWriter()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});