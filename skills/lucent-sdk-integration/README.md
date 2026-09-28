# Lucent SDK integration skill

This standalone Agent Skill teaches coding agents to add Lucent functionality as a native feature of an existing application. It makes the agent inspect the host architecture, design system, wallet, state, transaction flow, terminology, responsive behavior, and accessibility conventions before changing code.

The governing rule is:

> Lucent provides functionality. The host application provides the UX.

## Install

Copy the complete `lucent-sdk-integration` directory into a project- or user-level Agent Skills location supported by the coding agent.

Common locations include:

```text
.agents/skills/lucent-sdk-integration/
~/.agents/skills/lucent-sdk-integration/
```

Command Code also discovers skills under `.commandcode/skills/` and `~/.commandcode/skills/`. Keep the directory name `lucent-sdk-integration` because it must match the `name` in `SKILL.md`.

## Trigger examples

The skill is intended to activate for requests such as:

- “Add Lucent staking to this page.”
- “Integrate Lucent into our portfolio.”
- “Add Lucent staking to the SOL asset card.”
- “Add unstaking and claims.”
- “Show the user's Lucent position.”
- “Show Lucent pool information.”
- “Integrate Lucent without changing the existing UI.”

It is intentionally scoped so unrelated Solana development does not trigger it.

## Structure

- [`SKILL.md`](SKILL.md) is the concise control plane and mandatory workflow.
- [`references/`](references/host-application-discovery.md) contains versioned SDK facts and integration decisions loaded on demand.
- [`examples/minimal/`](examples/minimal/read-protocol-data.ts) contains framework-neutral TypeScript examples using public package exports.
- [`examples/react/`](examples/react/integration-recipe.md) and [`examples/nextjs/`](examples/nextjs/integration-recipe.md) adapt to host patterns without prescribing component libraries.
- [`templates/`](templates/integration-plan.md) standardizes planning and completion reporting.
- [`scripts/validate-skill.mjs`](scripts/validate-skill.mjs) validates standalone structure and safety rules.

## SDK scope

The bundled API reference was verified against `lucent-sdk@1.0.0`. The skill requires agents to inspect the application's installed package and prefer its exports, declarations, and runtime behavior whenever versions differ.

Important v1.0.0 constraints are explicit in the skill:

- writes require an `@solana/kit` `TransactionSigner`;
- write methods return an `ActionPlan`, and `plan.send()` performs signing, submission, and confirmation;
- positions and history require a configured hosted `apiUrl`;
- stake/unstake require a referral ID of at most 32 UTF-8 bytes;
- the reviewed snapshot's referral instructions were not yet deployed on live mainnet;
- no APY API or complete remaining-capacity API exists;
- no verified generic bridge from conventional Solana Wallet Adapter is bundled.

## Validate

From the directory containing the installed skill:

```sh
node lucent-sdk-integration/scripts/validate-skill.mjs
```

For a project-level installation from the repository root:

```sh
node .agents/skills/lucent-sdk-integration/scripts/validate-skill.mjs
```

If Command Code is installed, also run:

```sh
cmd skills list
```

Confirm `lucent-sdk-integration` appears without a frontmatter warning.

## Trust and distribution

Agent Skills are instructions that influence code and commands. Review the contents before installing or distributing them. The directory is self-contained and does not rely on the Lucent SDK source repository being present.
