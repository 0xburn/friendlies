import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        slippi: { green: '#21BA45', dark: '#0a0a0a', darker: '#050505', card: '#141414', border: '#2a2a2a' },
        rank: { bronze: '#E06A36', silver: '#B5A5B7', gold: '#F6A51E', platinum: '#91E8E0', diamond: '#4169E1', master: '#8B008B' },
      },
      fontFamily: {
        display: ['Chakra Petch', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'patreon-glow': {
          '0%, 100%': {
            boxShadow:
              '0 0 20px rgba(99, 102, 241, 0.12), 0 0 8px rgba(201, 162, 39, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
          },
          '50%': {
            boxShadow:
              '0 0 30px rgba(139, 92, 246, 0.16), 0 0 14px rgba(212, 175, 55, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
          },
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'patreon-glow': 'patreon-glow 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
