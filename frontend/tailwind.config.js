/** @type {import('tailwindcss').Config} */

// SkillCat Notesify theme bridge.
// Every value here points at a CSS variable defined in src/styles/skillcat-tokens.css
// (light + dark). The gray/blue/white/black scales are remapped so the app's
// existing utilities follow the theme; new code should prefer the semantic
// names (surface, ink, primary, success…).
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;
const scale = (prefix) =>
  Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((k) => [k, rgb(`--tw-${prefix}-${k}`)]));

module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', '"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', '"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        // ── Theme-following remap of the palettes the codebase already uses ──
        white: rgb('--tw-white'),
        black: rgb('--tw-black'),
        gray: scale('g'),
        neutral: scale('g'),
        slate: scale('g'),
        zinc: scale('g'),
        blue: scale('p'), // the old blue accent becomes the one SkillCat orange
        indigo: scale('p'),
        purple: scale('p'),
        orange: scale('p'),
        green: { 50: rgb('--tw-success-bg'), 100: rgb('--tw-success-bg'), 200: rgb('--tw-success-bg'), 500: rgb('--tw-success'), 600: rgb('--tw-success'), 700: rgb('--tw-success'), 800: rgb('--tw-success') },
        emerald: { 50: rgb('--tw-success-bg'), 100: rgb('--tw-success-bg'), 500: rgb('--tw-success'), 600: rgb('--tw-success'), 700: rgb('--tw-success'), 800: rgb('--tw-success') },
        red: { 50: rgb('--tw-danger-bg'), 100: rgb('--tw-danger-bg'), 200: rgb('--tw-danger-bg'), 400: rgb('--tw-danger'), 500: rgb('--tw-danger'), 600: rgb('--tw-danger'), 700: rgb('--tw-danger'), 800: rgb('--tw-danger') },
        yellow: { 50: rgb('--tw-warning-bg'), 100: rgb('--tw-warning-bg'), 200: rgb('--tw-warning-bg'), 500: rgb('--tw-warning'), 600: rgb('--tw-warning'), 700: rgb('--tw-warning'), 800: rgb('--tw-warning') },
        amber: { 50: rgb('--tw-warning-bg'), 100: rgb('--tw-warning-bg'), 200: rgb('--tw-warning-bg'), 400: rgb('--tw-warning'), 500: rgb('--tw-warning'), 600: rgb('--tw-warning'), 700: rgb('--tw-warning'), 800: rgb('--tw-warning') },
        sky: { 50: rgb('--tw-info-bg'), 100: rgb('--tw-info-bg'), 500: rgb('--tw-info'), 600: rgb('--tw-info'), 700: rgb('--tw-info') },

        // ── Semantic SkillCat tokens ──
        surface: {
          0: 'var(--sc-surface-0)',
          1: 'var(--sc-surface-1)',
          2: 'var(--sc-surface-2)',
          sunken: 'var(--sc-surface-sunken)',
        },
        ink: {
          strong: 'var(--sc-text-strong)',
          body: 'var(--sc-text-body)',
          muted: 'var(--sc-text-muted)',
          disabled: 'var(--sc-text-disabled)',
        },
        hairline: 'var(--sc-border-hairline)',
        brand: { DEFAULT: 'var(--sc-primary)', hover: 'var(--sc-primary-hover)' },
        success: { DEFAULT: 'var(--sc-success)', bg: 'var(--sc-success-bg)' },
        info: { DEFAULT: 'var(--sc-info)', bg: 'var(--sc-info-bg)' },
        warning: { DEFAULT: 'var(--sc-warning)', bg: 'var(--sc-warning-bg)' },
        danger: { DEFAULT: 'var(--sc-danger)', bg: 'var(--sc-danger-bg)' },

        // ── shadcn/ui semantic layer (values in globals.css, per theme) ──
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        tertiary: 'var(--sc-text-muted)',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        chart: { 1: 'hsl(var(--chart-1))', 2: 'hsl(var(--chart-2))', 3: 'hsl(var(--chart-3))', 4: 'hsl(var(--chart-4))', 5: 'hsl(var(--chart-5))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'var(--sc-radius-lg)',
        '2xl': 'var(--sc-radius-xl)',
      },
      boxShadow: {
        sm: 'var(--sc-shadow-sm)',
        DEFAULT: 'var(--sc-shadow-sm)',
        md: 'var(--sc-shadow-md)',
        lg: 'var(--sc-shadow-md)',
        xl: 'var(--sc-shadow-md)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
