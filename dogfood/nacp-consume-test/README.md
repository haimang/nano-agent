# nacp-consume-test

Minimal dogfood consumer for W2.

This package is intentionally **outside** the pnpm workspace so it proves a published or tarball install path instead of resolving through `workspace:*`.

## Published-path smoke

```bash
pnpm install --ignore-workspace
pnpm build
pnpm smoke
```

`NODE_AUTH_TOKEN` must be set so `.npmrc` can read from GitHub Packages.

## Pre-publish tarball smoke

Before the first real publish, validate the consumer path with local tarballs:

1. Pack `@nano-agent/nacp-core` and `@nano-agent/nacp-session`
2. Install those tarballs into a throwaway copy of this package
3. If you use pnpm, add an override for transitive `@nano-agent/nacp-core` so the packed `nacp-session` dependency does not fall back to the public registry
4. Run `pnpm build && pnpm smoke`

W2 closure treats this tarball path as pre-publish evidence only. The real GitHub Packages install remains optional until owner opens the first publish window.
