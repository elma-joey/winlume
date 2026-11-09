# Desktop account billing read model

`GET /api/desktop-auth/billing` reuses `desktopWalletContext` for desktop grant and
current workspace membership. It reads balance, settled consumption/error logs
and workspace-authorized pricing. It does not create orders, mutate model rates,
charge quota or reconcile old local client attempts by approximate timestamps.

User policy confirmed 2026-10-28: ¥1 = 1 credit; an enabled plan should be used
first, then automatically fall back to balance. Plan price and allowance remain
undecided. `INITIAL_BILLING_CONFIGURATION.allowBalanceFallback` records this policy;
settlement stays `legacy_balance` and no active plan or plan purchase is exposed.
Entitlement persistence, renewal and plan-first settlement are still required
before selling plans. This read endpoint is not that billing engine.

Missing quota is null, not free. Explicit zero remains zero. History uses actual
log quota / 500000, including charged errors; funding split is unreported. Current
prices never rewrite old charges. User-authenticated pricing respects group price
overrides and shows ranges across allowed groups, not a global cheapest price.
Expression/resolution pricing remains dynamic. No implicit USD/CNY conversion.

Wallet, usage and pricing failures remain independent. Desktop bearer and gateway
PAT stay server-side; raw log content and route internals are not returned. Deploy
this route alongside the updated desktop client; it is a read-only integration.

## Production deployment — 2026-10-28

The adapter was activated at 08:25:56 UTC (16:25:56 Asia/Shanghai) on the existing
Reizo web host `40.160.139.134`, service `reizo`, runtime `/opt/reizo`.

- Previous build: `ajWYJgpUaEhqnUa8QjYoI`; active build: `saJwqxB9XZhFmE2F_91HN`.
- Baseline: deployed commit `780e7157c72dc4ba157461b7564a588b547d3faa`, plus the
  seven billing source/test files and this operational document. A Git archive
  prevented unrelated desktop/local changes from entering the web release.
- Source `/opt/reizo-billing-build-20261028`; evidence `/opt/reizo-billing-fix-20261028`;
  rollback runtime `/opt/reizo-before-billing-20261028`.
- Runtime `billing-release.json` records baseline and source SHA-256 values. The
  retained dependency lock matched the baseline; no dependency installation or
  schema migration was required. Runtime environment, data, backups and previous
  static assets were preserved. A failed cutover health check would restore the
  previous runtime automatically.

Validation: 26 related local tests passed; production host 39 tests passed and one
existing PostgreSQL integration test was skipped. Production compilation,
TypeScript, static generation and standalone packaging passed. Preview verified
21 static assets, existing web/login/wallet routes, missing/invalid desktop bearer
rejection and no-store responses. Public checks passed after cutover; service was
active with zero restarts.

The running signed-in native client visibly displayed real remaining credits,
cumulative consumption and 47 settled consumption records, including image and
video charge rows. Its pricing tab loaded current account rates and supported
model search; parameter-dependent rules remained explicitly dynamic. No generation,
top-up order, payment or historical ledger rewrite was performed. The native
pagination controls were observed; paging authorization/query behavior is covered
by tests, but native next-page interaction was not completed during this check.

Future web releases must include this adapter; deploying a commit without it would
remove `/api/desktop-auth/billing` again. Plan pricing and entitlements remain
unconfigured, and the account ledger is separate from older local usage records.
