---
change_id: middleware-static-asset-exclusion
title: Middleware's matcher excludes favicon.ico by name but not static files generally
status: archived
created: 2026-11-18
updated: 2026-11-20
archived_at: 2026-11-20T16:10:00Z
---

## Notes

middleware's matcher only excludes favicon.ico by name, not static files
generally, so any new file in public/ (e.g. the Google Search Console
verification file) gets caught by the auth gate and redirected to /login
instead of served.

## Confirmed root cause (live investigation, 2026-11-18)

`src/middleware.ts:13`:
```
matcher: ["/((?!login|api/auth|api/test-auth|_next/static|_next/image|favicon.ico).*)"]
```

Only `favicon.ico` is excluded by exact name. Dropped
`public/google09b7bdc2b7ba546d.html` (a Search Console site-verification
file) into `public/` and deployed — confirmed live via `curl`:

```
$ curl -s https://swarmarena.hopto.org/google09b7bdc2b7ba546d.html
https://swarmarena.hopto.org/login?callbackUrl=...
```

The request is 307-redirected to `/login` instead of serving the static
file. This would make Google's verification crawler see a redirect, not
the file content, and fail the ownership check — and will silently break
any other static asset dropped into `public/` the same way (robots.txt,
sitemap.xml, etc.) going forward, not just this one file.

(Note, added 2026-11-19: `swarmarena.hopto.org` was the production domain
at the time of this test; production has since migrated to
`swarmarena.fun` — see `domain-migration-swarmarena-fun`. The command and
output above are an accurate historical log and are left as originally
tested, not rewritten to the new domain.)

## Fix shape (not yet implemented — pending /10x-plan)

Exclude any path whose last segment has a file extension (a dot), the
standard Next.js middleware idiom for "let static assets through" —
e.g. `.*\..*$` in the negative lookahead — rather than naming files one
at a time. `favicon.ico`'s explicit exclusion becomes redundant once this
lands (already covered by the extension pattern) but can stay or go.
