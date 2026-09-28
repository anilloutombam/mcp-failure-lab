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
prose. A checked test result can be converted into a draft report with an
authoring plan:

```bash
cp data/observatory/authoring-plan.example.json /tmp/observatory-plan.json
npm run observatory:prepare -- --input /tmp/observatory-plan.json
```

The preview command does not change the manifest. Review its identity,
categories, statuses, and observations, then append it with:

```bash
npm run observatory:prepare -- --input /tmp/observatory-plan.json --write
npm run observatory:validate
```

Result paths are resolved relative to the authoring plan. The compatibility
report must already exist in `docs/compatibility`. Status and duration are read
from each JSON scenario result; `scenarioName`, `status`, and `observation` may
be supplied when the reviewed record needs clearer wording or a
`needs-review` status.

The command intentionally leaves `findings` empty. A test result is not, by
itself, a verified Finding or proof of an upstream defect. Add reviewed Finding
and upstream-report metadata separately.

To edit the manifest without the authoring command, update it in the same pull
request as a compatible report and run:

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
