# IP records

| Date | Covers | Type | Record hash | Signer | Tag |
|---|---|---|---|---|---|
| 2026-11-26 | Commit `37fc83a`: a TypeScript (Fastify, PostgreSQL) API, source, migrations, tests and documentation. No authorship claimed in third-party libraries, published standards and the generated lockfile. | software, hash-only | [`178b9bbf3a85fb40a40ef2af175a1df6bd62a271b0f4e56408dde1f762ba0491`](https://iptrust.org/v/178b9bbf3a85fb40a40ef2af175a1df6bd62a271b0f4e56408dde1f762ba0491) | Gregory J. Ward | `ip-2026-11-26` |

A record is evidence that the committed content existed by the time of its anchor and that the signer made
the statement; it does not create or register any right. Anchoring completes some hours after submission.
Files under `third_party/`, where present, are not part of the record.

## Verifying

Verification needs the evidence package for the record, which the author holds and which is not committed
here. With it in `.iptrust/`:

```
git worktree add /tmp/at-tag-ts-api-starter ip-2026-11-26
cp -r .iptrust /tmp/at-tag-ts-api-starter/
(cd /tmp/at-tag-ts-api-starter && iptrust2 verify 178b9bbf3a85fb40a40ef2af175a1df6bd62a271b0f4e56408dde1f762ba0491 --fetch-headers)
git worktree remove --force /tmp/at-tag-ts-api-starter
```

Expect `verdict: valid` and `content: matched` once both chains have anchored.
