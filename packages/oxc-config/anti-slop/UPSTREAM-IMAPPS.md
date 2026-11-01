# Upstream

Vendored from https://github.com/dmmulroy/anti-slop at commit `13909c9e07590f5a85d93c62712259fe14a883f7`
via `skills/install-anti-slop/scripts/install.mjs`.

Changes from upstream: the `effect/` rule group was removed (no IM Apps repo uses `effect`). Everything else is unmodified.

This directory is the source of truth for the plugin; `tsup` bundles `anti-slop/index.ts` into `build/anti-slop.js`,
which is what the `@imapps/oxc-config/anti-slop` specifier resolves to (Node refuses to type-strip `.ts` under `node_modules`).
