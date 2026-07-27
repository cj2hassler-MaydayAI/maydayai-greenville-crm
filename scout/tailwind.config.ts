import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          DEFAULT: '#2B3440',
          ink: '#2B3440',
          muted: '#5A6472',
          line: '#C9C5BC',
        },
        bone: {
          DEFAULT: '#EDEAE3',
          deep: '#DFDBD1',
        },
        // Three signal colors. Verdicts only — never decorative.
        verified: '#0F8B4C',
        unknown: '#8A8F98',
        flagged: '#C6303A',
      },
      fontFamily: {
        display: ['"Archivo Narrow"', '"Archivo Condensed"', 'Oswald', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: {
        field: '46rem',
      },
    },
  },
  plugins: [],
};

export default config;
