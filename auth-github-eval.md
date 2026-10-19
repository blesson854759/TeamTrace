# TeamTrace UI evaluation — Authentication and repository activity

**Verdict: PASS — for the rendered authentication flow only.** This is not a full sign-off of repository activity: that authenticated view could not be reached without creating a persistent evaluation account, which I avoided.

## Scope and evidence

Reviewed the live app at `http://localhost:5173` against the supplied brief at desktop (1440px), tablet (768px), and mobile (375px), including sign-in and create-account states, form validation, keyboard operation, and GitHub configuration messaging. Captured desktop and mobile screenshots during review. The updated API reported health `ok` on port 4000.

The exercised API states were consistent with the visible flow: `GET /api/auth/config` returned `200` with `githubOAuth.enabled: false`; invalid `POST /api/auth/login` and `POST /api/auth/register` requests returned `400` validation errors (the server rejected `faculty`, allowing only `member` or `leader`); protected projects/GitHub routes returned `401` without a session. No mismatch was found in these exercised paths. No valid account was created and no OAuth credentials were available, so successful sign-in, OAuth callback, and authenticated repository setup/sync were not tested. The GitHub start route returns a generic `503` when called directly while unconfigured; the UI disables that action and shows the configuration explanation instead.

## Scores

| Criterion | Score | Status | Weight | Notes |
|---|---:|---|---|---|
| Design Quality | 2/3 | PASS | HIGH | Coherent warm-neutral auth panel against a deep-ink/teal editorial hero; clear hierarchy and consistent branding. |
| Originality | 2/3 | PASS | HIGH | Distinctive serif/italic headline, gradient field, and compact two-state registration form; split-screen auth is familiar but well tailored. |
| Craft | 1/3 | PASS | MEDIUM | Responsive geometry is sound; small muted supporting text has insufficient contrast. |
| Functionality | 1/3 | PASS | MEDIUM | Both auth modes render, native validation and role choices work, and the disabled OAuth state is explained. Authenticated repository activity remains unverified. |

## Findings

### Strengths
- Clear, separate “Sign in” and “Create account” states; registration visibly limits roles to Team Member and Team Leader and explains the 10-character password minimum.
- Labels and accessible names are present; email/password autocomplete is appropriate. Browser validation blocks malformed email and passwords under 10 characters. The native role radio group switches with arrow keys.
- OAuth is honestly disabled when configuration is absent, with a visible explanation and working email/password alternative. No demo-account panel or sample workspace is shown on the unauthenticated screen.
- Layout adapts cleanly: the hero disappears on mobile; the form remains usable and scrollable at 375px; measured document width did not exceed the viewport at any tested width.

### Issues / follow-up
1. **Supporting copy is too small and low-contrast.** Auth intro text is 11px with about 3.51:1 contrast; the 9px OAuth-unavailable message is about 3.26:1 against the warm background. Both fall short of WCAG AA’s 4.5:1 for normal text and are particularly hard to read on mobile. Increase the type size and darken the text.
2. **ARIA tabs lack arrow-key navigation.** Both tab buttons can be reached with Tab and activated with Enter, but ArrowLeft/ArrowRight leave the selected tab unchanged. Implement the expected arrow/Home/End behavior with roving tab index, or use a non-tab toggle pattern.
3. **Repository activity/config UI not assessed.** Without a signed-in session, the project/repository settings and actual activity list are inaccessible (API returns 401). Inspect connected, unconfigured, empty, sync-success, and honest-error states after a safe authenticated test account is available; verify real GitHub data is shown without sample activity.

**Next step: REFINE.** Keep the current visual direction; improve small-copy legibility and tab keyboard semantics, then complete an authenticated review of repository connection and activity states. The PASS above applies only to the inspected auth UI and expected unconfigured OAuth state, not to the unobserved repository workflow.
