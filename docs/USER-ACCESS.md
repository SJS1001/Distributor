# User access runbook

Date: 2026-09-30. Local engineering candidate; no product gate is verified. Identity owns principals, grants, security revisions, password hashes and sessions. Warehouse/account validation uses the owning modules. See [implementation](IMPLEMENTATION.md), [contracts](CONTRACTS.md) and the [local receipt](evidence/LOCAL-USER-LIFECYCLE-2026-09-30.md).

## Administrator operations

Open Administration → Staff and buyer access. Creating a user requires the administrator's current password; HTTP creation defaults to a required initial password change. Choose a role and permitted warehouses; buyers require an existing customer account. Empty staff site lists currently grant all organization warehouses, so review that selection explicitly. Email addresses are unique across the runtime. No invitation or password-delivery service exists; approved credential handoff remains an operating responsibility.

Edit access changes name/email, role, buyer account, permitted warehouses and active status. Enter the current administrator password and a reason. The displayed security revision must still match; on STALE_USER, refresh and review current values before submitting a new decision. Every successful access edit ends all affected sessions, including edits to name/email. Deactivated users cannot sign in. Reactivation permits a new sign-in but restores no old sessions. An organization must retain at least one active administrator; concurrent demotions/deactivations serialize against that invariant.

Reset password requires current administrator authentication, the target revision, a different 14–256-character initial password and a reason. It ends all target sessions and forces another password change. Revoke sessions similarly requires the current revision/password/reason and ends all sessions existing at that transaction. It does not disable future sign-ins. Both operations advance the target security revision. Actions affecting the acting administrator return to sign-in.

## Personal security

Users with an initial/reset password must change it before opening the workspace or processing finance work. Only session/security, password change, sign-out and own-session termination are available at that stage. Change password requires the current password, a different 14–256-character replacement and matching confirmation in the UI. It clears the forced-change flag and ends all sessions; sign in with the replacement.

Security → End all my sessions → End sessions ends every current session without asking for a password. It cannot increase access. A later sign-in creates a new session. Administrator user lists expose name/email, role/account/sites, active status, security revision, required-change flag and active session count; ordinary users receive only their own security summary. Password hashes, salts, tokens and CSRF values are excluded from these summaries and command/audit payloads.

## Retry and failure behavior

HTTP commands require an authenticated current session, CSRF/origin checks, exact request shape and an idempotency key. Current administrator/password and organization authority are rechecked before cached administrative results. Retry identical pending actions with their original key; changing inputs requires a new reviewed action. A cached revocation reports the original boundary and does not revoke sessions created afterward. Self-revocation/password change invalidates the calling session, so a committed operation with a lost response can make the old session return 401. Return to sign-in; use the replacement password after a password change, then inspect the current state with authorized access.

Successful changes commit credentials/grants, session invalidation, security revision, durable result and audit together. A late-write error rolls them back. Login rereads credentials and active status inside the session/audit transaction after hashing. Failed authentication uses a shared email counter with an atomic SQL increment and 15-minute expiry; eight recorded failures block further attempts until expiry. Counts survive denied business transactions. This is a bounded local throttle, not distributed abuse protection. Sessions expire after eight hours; server authorization reads current principal grants.

## Qualification still required

MFA, invitations, approved credential delivery, verified email changes, forgotten-password recovery, administrator recovery, breach/password screening, session-device metadata, distributed throttling, retention and separation-of-duty policy remain open. Existing/legacy users default to revision 1 without a forced-change flag; additive schema creation is not production upgrade qualification. An active administrator count does not establish that an administrator can recover access. Production TLS, infrastructure/residency, operational support and independent security review also remain pending. Local automated evidence is not G1/security approval.

Design reference: OWASP [authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) guidance informed current-password checks, session invalidation and the explicit recovery gap; no compliance certification is claimed.
