/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#9333ea',
          hover: '#7e22ce',
          muted: 'rgba(147, 51, 234, 0.2)',
        },
        'background-dark': '#0f0218',
        'background-light': '#1a0c2e',
        'card-dark': '#1e0f2e',
        'surface-dark': '#23182d',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scan-line': 'scanLine 2s ease-in-out infinite',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: 0 },
          '100%': { transform: 'translateX(0)', opacity: 1 },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        scanLine: {
          '0%, 100%': { transform: 'translateY(0)', opacity: 0.8 },
          '50%': { transform: 'translateY(256px)', opacity: 1 },
        },
      },
    },
  },
  plugins: [],
}
