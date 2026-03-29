import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    worker: {
      format: 'es',
    },
    build: {
      cssCodeSplit: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/node_modules/pdfjs-dist/')) return 'parser-pdf';
            if (id.includes('/node_modules/epubjs/')) return 'parser-epub';
            if (id.includes('/node_modules/mammoth/')) return 'parser-docx';
            if (id.includes('/node_modules/jszip/')) return 'parser-zip';
            if (id.includes('/node_modules/firebase/')) return 'firebase-vendor';
            if (id.includes('/node_modules/@supabase/supabase-js/')) return 'supabase-vendor';
            if (id.includes('/node_modules/@google/genai/')) return 'genai-vendor';
            if (id.includes('/node_modules/lucide-react/')) return 'ui-icons';
            if (id.includes('/node_modules/motion/')) return 'ui-motion';
            if (
              id.includes('/node_modules/react-markdown/')
              || id.includes('/node_modules/remark-')
              || id.includes('/node_modules/rehype-')
              || id.includes('/node_modules/mdast-')
              || id.includes('/node_modules/micromark/')
              || id.includes('/node_modules/unified/')
            ) {
              return 'markdown-vendor';
            }
            if (id.includes('/node_modules/react-router/') || id.includes('/node_modules/react-router-dom/')) {
              return 'router-vendor';
            }
            if (
              id.includes('/node_modules/react/')
              || id.includes('/node_modules/react-dom/')
              || id.includes('/node_modules/scheduler/')
              || id.includes('/node_modules/use-sync-external-store/')
            ) {
              return 'react-vendor';
            }
          },
        },
      },
    },
  };
});
