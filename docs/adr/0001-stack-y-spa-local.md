# ADR 0001 — Nuxt 4 en modo SPA servido por Nitro en loopback

- **Estado:** aceptada (2026-11-08)
- **Contexto:** la especificación pide Nuxt + TypeScript + CSS, kiosco Chromium sobre Wayland, mínimo consumo y nada externo.
- **Decisión:** Nuxt 4.6 con `ssr: false`, preset `node-server`, escuchando en `127.0.0.1:3000`. TypeScript 5.9 estricto (`vue-tsc` no garantiza aún compatibilidad con TypeScript 7). npm workspaces (sin herramientas extra). Node 24 LTS en la Pi.
- **Consecuencias:**
  - (+) Sin render en servidor: menos CPU; el servidor solo entrega estáticos y API.
  - (+) Un único proceso web; CSP aplicable a todo.
  - (−) Sin JS no hay interfaz: mitigación en Fase 2 con página de recuperación estática local antes de lanzar Chromium.
  - (−) Nuxt SPA inyecta un `<script>` inline de configuración ⇒ CSP con `'unsafe-inline'` en `script-src`. Aceptable porque `default-src`/`connect-src` siguen en `'self'` y no hay contenido de terceros.
