# Project memory

## Product intent & audience

- Movie streaming web app (PWA) with Telegram integration
- Targets both web/browser preview and native Android (via Telegram client)

## Brand personality & voice

- User communicates in Hinglish (Hindi written in Latin script)
- Respond in same Hinglish style; keep technical terms in English

## Visual design & UX direction

- Splash screen with framer-motion (`motion` package) animation; `onAnimationComplete` transitions to main content
- Video playback uses `data-exo-active` attribute on root; CSS rule hides entire app when active (ExoPlayer-style fullscreen video)
- PWA setup via `vite-plugin-pwa` with service worker registration
- Browser shim globals injected for Telegram stream support (native Android only)

## Decisions, constraints & rationale

- **Service worker cleanup added on startup**: unregisters stale/old service workers to prevent blank preview caused by cached content in iframe
- `server.ts` overrides Vite's `@vite/client` HMR client with custom implementation
- `framer-motion` imported via `motion` package (not `framer-motion` directly)
- Build passes; dev server serves HTML, main.tsx, CSS correctly; all modules transform without Vite errors
- Blank preview diagnosed as stale SW issue, not a code/build error

## Open questions & assumptions

- Whether the splash screen's `onAnimationComplete` can fire before main content is ready, causing a blank gap — not yet confirmed or addressed
- Whether the custom `@vite/client` override in `server.ts` contributes to any HMR/preview instability
- Long-term need for the `data-exo-active` hide-everything CSS rule vs. a scoped overlay approach