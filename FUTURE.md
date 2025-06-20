# Future considerations for new features

This document captures ideas or enhancements that are currently **out-of-scope** but worth tracking for later iterations.

Once a issue management solution is set up for diff.email (Linear, GitHub, Jira), consider moving these into issues.

## Version Diff Visualization

Add the ability to check diffs between versions or groups of versions. Use either Monaco Editor or Shiki for this.

## Improve sign in / sign up flow

See https://www.shadcndesign.com/pro-blocks/sign-in for design inspiration.

## Data Table

Reformat the results lists (when in list view) to operate like a true data-table with options for filtering, exporting, sorting, drag-and-drop, bulk CRUD actions etc.

## Naming collisions countermeasures

Currently, all projects and emails are unique by their generated IDs. But for better user experience, we should put guards in place to ensure that project and email names are always unique to their scope. Also consider enforcing a specific file name structure like all lowercase alphanumeric and no spaces.

## User-defined starter templates

Currently new e-mails are seeded with a built-in boilerplate (simple HTML skeleton or a JSX `index.tsx` component).  We should let users save their own message as a reusable template and choose it when creating the next e-mail.

Planned flow (not implemented):

1. Editor gains a "Save as template..." action.
2. Dialog asks **scope** → "This project only" vs "My account (all projects)".
3. For HTML we store the raw `html` field; for JSX we store the serialised `files` map.
4. New-e-mail dialog shows a "Template" selector whose default is "Built-in default".

This implies adding a `templates` table and exposing CRUD via tRPC.  Until then the codepaths fall back to the bundled defaults using the `defaultHtmlTemplate` / `defaultJsxTemplate` helpers.

## Automatically route to project or email upon creation

Consider if it would be generally valuable to automatically route into a project or email after creating it. For power users this may be more annoying than helpful though, if they are creating projects in bulk.

## Outlook Web deep-link via Graph / EWS

Current MVP falls back to subject-search polling in Outlook Web.  A more reliable and faster path is to:

1. Register an Azure AD application with `Mail.Read` scope.
2. From the worker, use the client-credentials grant to call Microsoft Graph and retrieve the `itemId` for the just-sent message.
3. Deep-link to `https://outlook.office.com/mail/0/inbox/id/<itemId>` for an instant open.

This requires three new env-vars (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`) and token refresh logic in the worker.

## Passkeys / WebAuthn for Automated Login

Automating 2FA via passkeys or WebAuthn would remove the dependence on TOTP secrets and reduce friction when providers deprecate TOTP.  Playwright supports WebAuthn emulation, but the flow differs per provider and is currently brittle in CI.  Re-evaluate once browser & provider support stabilise.

## Security policies

We need to either find a way to only show thumbnails temporarily and clear them after each run, or save them for a certain amount of time (maybe 1 month) and give the user the option to delete them sooner if they wish, and also to regenerate screenshots from stale runs where screenshots have expired.

## Password-manager Integration for TOTP

Instead of storing the 32-char TOTP secret in env-vars, consider integrating a secrets manager (1Password Connect, HashiCorp Vault, etc.) that can generate TOTP codes on demand, further reducing secret sprawl.

## Dark mode

Add better support for dark mode, toggling email client option for dark mode and emulating dark mode via CSS.

Consideration: If the overhead on toggling between light and dark mode is too much, or if it poses a risk with multiple workers working in parallel (e.g. one toggling into dark mode while another attempts to take a screenshot in light mode), consider creating different mail account for light vs. dark mode.

## Use email client APIs for faster email availability checks and meta details

Use email client APIs/SDKs to check email details (in spam vs. not, etc.), email readiness, deep-link IDs, etc.

## Fully-Automated iCloud 2FA via SMS API (Twilio)

The MVP captures iCloud session cookies once (after a human approves the initial 2FA SMS) and reuses them for ~90 days. For uninterrupted, unattended operation, migrate to an SMS-automation flow using Twilio:

1. Add a programmable SMS number (Twilio, Vonage, etc.) as a **trusted phone** on the Apple ID.
2. Update the Playwright login helper to select "Text Message to +<TwilioNumber>", then poll Twilio's REST API for the six-digit code:
   ```ts
   const sms = await pollTwilioCode(env.TWILIO_SID, env.TWILIO_TOKEN, env.TWILIO_NUMBER);
   await page.fill('input[name="code"]', sms);
   ```
3. On success, save the new storageState and overwrite the blob file. The SMS flow will only run when cookies expire.

Additional env-vars: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_NUMBER`.

This upgrade removes all human steps from iCloud log-ins while keeping the worker architecture unchanged.

## Add support for physical device screenshots (high effort)

Look into setting up a screenshot architecture and workflow for physical devices and native apps. This will require organizing my own VM/device farm locally or resourcing a service like HeadSpin (https://www.headspin.io/) for testing.

HeadSpin's unlimited usage plan starts at $125/mo, but it would likely still lack some feature I would need, so I would need to explore pricing options for their enterprise-level CloudTest Pro plan (prices not listed).

It would be great to find a way to integrate with HeadSpin or a similar service that would work in the heart of this being a dedicated open-source project, to the extent that I would consider starting with HeadSpin and eventually launching a second related open-source platform for dedicated pay-as-you-go usage-billed VM/device farm usage with safe device restores between sessions.

One other considerations here is that rather than buying many different devices, I may be able to get "close enough" for Apple device usage using the official Apple Xcode Simulators available for iOS, iPadOS, watchOS, tvOS, and visionOS. This separate business entity would operate both to empower diff.email as well as exist as its own standalone product/service, also pay-as-you and usage-billed.

For different browser-based testing, if there was a need, a service like BrowserStack or TestGrid might be worth looking into, though that would be purely for OS/browser-based testing, but without access to native apps.

## Fine-grained observability (internal)

Add Prometheus (prom-client + /metrics + Grafana Cloud) for queue depth, screenshot latency & error-rate SLOs.

## Observability vision

diff.email should feel like an APM tool for email screenshots. Each run emits structured logs, distributed traces, and high-cardinality metrics that flow into a unified Grafana + Tempo + Loki stack. Operators see real-time RED/USE dashboards (request rate, error rate, latency p50/p95) broken down by client engine and dark-mode flag, while power users can drill into per-project histograms ("Gmail Web p95 = 2.8 s this hour") and click straight through to the raw Playwright trace or console log of any failed screenshot. Alert rules fire to Slack & PagerDuty on SLO breaches, and every metric label is correlated back to the exact Version / Run / Screenshot row, making root-cause analysis a two-click journey from chart to code diff.

## CSS-support linter

On save/edit, scan HTML/CSS through the caniemail.com API and flag unsupported properties per target client (e.g.,"position: fixed not supported in Gmail Web").

## Preview toggle

Instantly switch between the sandboxed live preview iframe (quirks simulation per client) and the latest real-engine screenshot grid.

## Diff overlay mode

Conditionally show a pixel-by-pixel slider to compare two screenshots (current vs. baseline) with thresholded highlight for visual regressions

## Performance budgets

Show estimated queue wait time and live concurrency slots per engine so users know when their run will finish.

## Activity & audit trail

Surface a timeline ("Alice triggered Run #42, Bob deleted Version #5") with exportable CSV for compliance.

## Accessibility checker

Run axe-core (or similar) on the preview to warn about missing alt text, poor contrast, or tab-order issues.

## AI repair hints

Use OpenAI to suggest fixes when a screenshot fails to render as expected ("Try adding width to this <td> to avoid clipping in Outlook").

## Screenshot retention controls

Allow per-project TTL, cold-storage archiving, and one-click redaction for GDPR requests.

## Webhook & Zapier triggers

Fire events (`run.finished`, `screenshot.failed`) so teams can pipe data into Slack, Datadog, or custom CI pipelines. Prioritize compatibility with GitHub Actions.