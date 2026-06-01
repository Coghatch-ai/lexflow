/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/index.html', './app/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#16161a',
          raised: '#1f1f25',
          soft: '#3f3f46',
          mute: '#6b6b75',
        },
        paper: {
          DEFAULT: '#f4f4f6',
          sink: '#ececef',
        },
        surface: '#ffffff',
        line: {
          DEFAULT: '#e5e5ea',
          strong: '#d3d3da',
        },
        seal: {
          DEFAULT: '#9a7322',
          ink: '#b8893b',
          bright: '#d9ab53',
          wash: '#f6efdd',
        },
        pos: '#3f7a52',
        neg: '#b04638',
        warn: '#b07d22',
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      // Refine the radii + shadows the vendored pages already lean on, so the
      // whole app sheds its "floating rounded bubble" look without per-file edits.
      borderRadius: {
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        DEFAULT: '0 1px 2px rgba(16,16,20,0.04), 0 1px 1px rgba(16,16,20,0.03)',
        md: '0 4px 12px -6px rgba(16,16,20,0.12)',
        lg: '0 12px 32px -16px rgba(16,16,20,0.20)',
      },
      letterSpacing: {
        tightish: '-0.018em',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};
