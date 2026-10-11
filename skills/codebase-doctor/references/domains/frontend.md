# Frontend Lens

Hunt for defects in client-side architecture, rendering, data fetching, accessibility, and browser-exposed secrets. A finding is a concrete component, hook, or config line with a user-visible or security consequence, such as a client component shipping a large library for static content or a `NEXT_PUBLIC_` variable holding a private key. Stylistic component preferences are not findings.

## Where to look first
- Component and page trees: `app/`, `pages/`, `src/components/`, `src/routes/`, React/Vue/Svelte/Angular files, Next.js `layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, Remix loaders, Nuxt `pages/`.
- Data fetching: `useEffect` with `fetch`, `useSWR`, TanStack Query hooks, server components with `await fetch`, `getServerSideProps`, loaders, API client modules.
- Config: `next.config.js`, `vite.config.ts`, `.env*`, `package.json` dependencies, bundler analyzer output, `tsconfig.json`.
- Grep patterns: `'use client'`, `dangerouslySetInnerHTML`, `innerHTML`, `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `useEffect(` containing `fetch(`, `key={index}`, `<img` without `alt`, `onClick` on `<div>`, `localStorage.setItem(`, `import .* from 'lodash'`, `import moment`, `.map(` over large arrays, `<Suspense`, `ErrorBoundary`, `suppressHydrationWarning`, `Date.now()` or `Math.random()` in render.

## How to trace
- Start at the route or page component and follow the component tree downward, noting where data is fetched, where state lives, and where the client boundary starts.
- Trace each fetch to its consumer: does one request wait on another before starting, is the result cached or deduplicated, and what does the UI show during loading and failure.
- Follow every environment variable with a public prefix from definition to use; check its value type (publishable key versus secret) across `.env` files and CI config.
- Trace user-controlled strings (URL params, API responses, markdown) to render sinks such as `dangerouslySetInnerHTML`, `href`, and `src`, and find the sanitizer if one exists.
- Check the server-to-client prop boundary: values passed from server to client components must be serializable and must not carry secrets.
- Grep for importers rather than assuming a heavy dependency is only used once; a single import in a shared layout reaches every page.

## Checks
- **Server versus client components**: Flag `'use client'` on components that need no state or browser APIs, and large dependencies pulled into client bundles where a server component could render the result.
- **Bundle size**: Flag whole-library imports (lodash, moment, icon packs), missing dynamic imports for heavy routes, and duplicate libraries for the same job.
- **Loading and error states**: Flag fetches with no loading UI, no error handling, or no `error.tsx` or error boundary around data-driven trees; flag missing `Suspense` around async server components.
- **Waterfall fetches**: Flag child components that start fetching only after the parent's fetch resolves when the requests are independent.
- **Data fetching correctness**: Flag effects with missing cleanup or stale closures, fetches without cancellation causing race conditions, and refetching on every render.
- **Unkeyed or index-keyed lists**: Flag `map` output with no `key` or with `key={index}` on reorderable or editable lists.
- **Hydration mismatches**: Flag render output depending on `window`, `Date.now()`, `Math.random()`, or locale formatting that differs between server and client.
- **Accessibility basics**: Flag interactive `div` or `span` elements with no role and keyboard handling, images without `alt`, inputs without labels, and icon-only buttons with no accessible name.
- **Secret leakage**: Flag `NEXT_PUBLIC_`, `VITE_`, or `REACT_APP_` variables holding private keys, service-role tokens, or internal URLs.
- **Unsafe rendering**: Flag `dangerouslySetInnerHTML` or `v-html` fed by unsanitized data, and `javascript:` URLs built from input.
- **List rendering**: Flag very large lists rendered without virtualization or pagination.

## Category slugs
- `unnecessary-client-component`
- `large-bundle-import`
- `missing-loading-state`
- `missing-error-boundary`
- `fetch-waterfall`
- `fetch-race-condition`
- `effect-missing-cleanup`
- `unkeyed-list`
- `hydration-mismatch`
- `missing-a11y-label`
- `non-semantic-interactive`
- `public-env-secret`
- `unsafe-html-render`
- `unvirtualized-list`

## Severity anchors
- **critical**: Private key or service-role token exposed in the client bundle, or user-controlled HTML rendered unsanitized on a logged-in page.
- **high**: Core flow unusable on fetch failure (blank screen, infinite spinner), race condition that shows another entity's data, critical action unreachable by keyboard.
- **medium**: Multi-second waterfalls on primary pages, oversized client bundles, hydration warnings that cause layout flashes, unvirtualized long lists, missing error boundaries.
- **low**: Index keys on static lists, missing `alt` on decorative images, redundant `'use client'` on small components, minor re-render waste.

## Not a finding here
- `NEXT_PUBLIC_` or `VITE_` variables that hold publishable values by design (analytics ids, Stripe publishable keys, Supabase anon keys, public API base URLs).
- `key={index}` on a static list that is never reordered, filtered, or edited.
- `dangerouslySetInnerHTML` fed by constants or by output passing through a located sanitizer such as DOMPurify.
- `'use client'` on a component that uses state, effects, event handlers, or browser-only APIs.
- A fetch inside `useEffect` in a small internal tool where the framework offers no server data layer and loading and error states are handled.
- Large list rendering where pagination or a hard item cap bounds the length.
