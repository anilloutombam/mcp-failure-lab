# MCP Failure Observatory data

`compatibility-reports.json` is the versioned ingestion contract between MCP
Failure Lab and MCP Failure Observatory.

The manifest contains normalized facts that are difficult to recover reliably
from human-oriented Markdown:

- the implementation identity, kind, version, and repository;
- scenario names, stable slugs, and categories;
- one stable run alias per transport result;
- status, duration, and a concise evidence-backed observation;
- reviewed Finding and upstream-report links when available.

The JSON is canonical source data, not a generated interpretation of report
prose. Update it in the same pull request as a compatible report and run:

```bash
npm run observatory:validate
```

The validator rejects malformed values, duplicate identities, broken Finding
references, missing report files, and records that are not MCP implementations.
After a valid change reaches `main`, GitHub publishes the file through the
repository's raw content URL and notifies the Observatory when its dispatch
token is configured.

## Stable identity

Do not rename an existing report ID, scenario slug, run alias, or Finding ID.
The Observatory derives stable source keys from these values so repeated imports
update existing imported records rather than creating duplicates.

## Scope

Only MCP implementation compatibility reports belong here. Decision experiments
and other research records are outside this manifest's scope.
