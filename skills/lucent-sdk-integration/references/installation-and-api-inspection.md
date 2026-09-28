# Installation and API inspection

The installed SDK is the source of truth. This reference records the inspection process; it is not permission to assume the v1.0.0 contract applies to another version.

## Detect the package manager

Use workspace configuration and lockfiles:

| Evidence | Package manager |
| --- | --- |
| `pnpm-lock.yaml` or `pnpm-workspace.yaml` | pnpm |
| `yarn.lock` | Yarn |
| `bun.lock` or `bun.lockb` | Bun |
| `package-lock.json` | npm |

In a monorepo, run dependency commands in the owning workspace using its established filtering/workspace syntax. Do not create a second lockfile.

## Check whether Lucent is installed

Inspect the owning package manifest, workspace catalog/overrides, and lockfile. Confirm:

- resolved `lucent-sdk` version;
- resolved `@solana/kit` version;
- whether both resolve in the browser/client package that will import them;
- whether package overrides or peer-dependency policies apply.

For `lucent-sdk@1.0.0`, the peer range is `@solana/kit >=8.0.0 <9`.

## Install only when absent

Use the detected package manager and the owning workspace. Typical single-package commands are:

```sh
npm install lucent-sdk @solana/kit
pnpm add lucent-sdk @solana/kit
yarn add lucent-sdk @solana/kit
bun add lucent-sdk @solana/kit
```

Run only the matching command. If the host already pins a compatible Kit version, preserve it. If versions conflict, stop and resolve compatibility from package metadata instead of forcing installation or duplicating Kit.

## Inspect the actual API

Before writing an import or method call:

1. Read the installed `lucent-sdk/package.json`.
2. Check its `exports`, version, peer dependencies, and runtime requirements.
3. Read the exported declaration file for the selected entry point.
4. Search declarations for the exact method, parameters, options, return type, and errors.
5. Inspect packaged source maps/source or official version-matched source only when declarations are insufficient.
6. Check the lockfile to ensure the inspected copy is the resolved copy used by the host.

For v1.0.0, public package entry points are only:

```ts
import { createLucentClient } from 'lucent-sdk'
import { settleAll } from 'lucent-sdk/keeper'
```

Do not deep-import `lucent-sdk/dist/*`, generated modules, internal actions, or source paths. Internal symbols may exist in the repository without being package exports.

## Authority order

When sources disagree, use this order:

1. installed package exports and TypeScript declarations;
2. installed runtime/source behavior and executable tests;
3. version-matched release/deployment notes;
4. this skill's versioned references;
5. prose README examples or unversioned documentation.

Record discrepancies that affect the integration. Do not silently choose the most convenient claim.

## Version adaptation

If the installed version is not `1.0.0`:

- use this skill for host-first behavior and UX rules;
- rebuild the API map from the installed version;
- recheck signer, network, referral, hosted API, transaction, and deployment requirements;
- do not copy v1.0.0 examples until they typecheck unchanged;
- update implementation notes with the actual resolved version.

## Validate after installation

Run the host's normal dependency, typecheck, lint, test, and build gates. Inspect the lockfile diff and ensure only the intended workspace dependency graph changed.
