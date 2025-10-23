import {heroui} from "@heroui/theme"

/** @type {import('tailwindcss').Config} */
const config = {
  content: {
    files: [
      './components/**/*.{js,ts,jsx,tsx,mdx}',
      './app/**/*.{js,ts,jsx,tsx,mdx}',
      './lib/**/*.{js,ts,jsx,tsx,mdx}',
      './styles/**/*.{css,scss}',
      "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
    ],
    extract: {},
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  darkMode: "class",
  plugins: [heroui()],
}

export default config;