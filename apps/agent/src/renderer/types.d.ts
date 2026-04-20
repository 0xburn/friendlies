/// <reference types="vite/client" />
import type { ElectronAPI } from '../preload';

declare global {
  interface Window {
    api: ElectronAPI;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          preload?: string;
          allowpopups?: boolean;
          nodeintegration?: boolean;
        },
        HTMLElement
      >;
    }
  }
}
