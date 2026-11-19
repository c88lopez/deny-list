# src/CLAUDE.md

## No `unknown` where the shape is known

Don't type data as `unknown` when you know, or can define, its shape. In particular, request data (`@Body()`, `@Param()`, `@Query()`) gets a DTO: the output type of a zod schema, produced by a pipe that validates it. A handler never sees unvalidated input.

- The schema is the DTO's single source. Export its output type (`z.output<typeof schema>`) instead of writing a class or interface that repeats it. There's no class-validator here.
- The pipe implements `PipeTransform<unknown, Dto>` and throws `BadRequestException` with zod's issues. See `entries/entry.pipe.ts` (`ParseEntryPipe`) and its use in `entries/entries.controller.ts`, e.g. `@Body(ParseEntryPipe) key: EntryKey`.
- Responses are typed too (`EntryBody` in the entries controller), not passed through as `unknown` or `any`.

`unknown` is right only where a value really is untyped until checked:

- the input of a validator or pipe (`parseEntry(input: unknown)`, `validateEnv`)
- caught errors (`.catch((err: unknown) => ...)`)
- a framework value that's narrowed right after (`req.route` in `metrics/metrics.service.ts`)

Lint enforces this in controllers: `typescript/no-restricted-types` bans `unknown` in `src/**/*.controller.ts` (`.oxlintrc.json`). Elsewhere it's this rule, not a lint rule, so don't add `unknown` there to avoid writing a type.
