# Public layout implementation — 2026-10-07

The owner approved the reviewed homepage composition and matching public catalogue, product detail, sign-in, application and activation pages. Customer and administrator workspace layouts are outside this change. This is a workstation implementation and local preview, not a production deployment.

## Change

- Navy header with equally sized outline Sign in and filled Apply for a trade account actions. Removed duplicate header links and repeated homepage application/process panels.
- Compact hero and three square-image category cards. Ductless includes single- and multi-zone families; previous category links still work.
- Preserved the five-product carousel with named previous/next, slide selection and play/pause controls inside its panel, outside the product link. Explicit pause, focus/hover pause and reduced motion remain supported.
- Public forms/catalogue share the header, narrower content measure and aligned breadcrumbs. Adjacent application fields align when labels wrap.
- Removed the public footer demonstration wording and demonstration prefix on prefilled sign-in guidance. Seed data and runtime behavior remain unchanged; workspace demonstration-label removal is not claimed.
- Staff/scanner entrances remain in the footer; authenticated visitors retain their role-specific workspace entrance and sign-out.

No backend, schema, package, provider, image provenance or deployment changes. The shared library gains a ductless filter; workspace styling is unchanged.

## Verification

Base commit `e0546e9`. Final seven-file source/test manifest SHA-256: `947fc1401686caec16e03af89d3f73905ce3f35f2798dfca2e4368720395b494`; private manifest/logs in `.local/public-layout-review/`. Tests used built Vite assets, an isolated native Fastify fixture, Node 24.16.0 and Playwright Chromium/WebKit on the workstation.

- Native public browser journeys: 20/20 per engine, including isolated application submission, approval, invitation activation, buyer sign-in, sessions, product documents, history and scanner shutdown.
- Public UI suite: 6/6 per engine, including widths 1440/1200/768/390/320, header alignment, square images, carousel control bounds, overflow, contrast, pause/reduced motion and both ductless ranges.
- Visual route sweep: six pages at 1200/390/320, 18/18 without overflow or page errors. Desktop/phone homepage, sign-in and application screenshots inspected. Implementation opened in the internal browser at `http://127.0.0.1:3125/#home`.
- Final three-line CSS field-alignment correction followed those 52 suite checks. Rebuilt assets and direct alignment/overflow checks pass 8/8 across both engines at 1200/768/390/320.
- Typecheck, build, changed-file Prettier, diff whitespace and planning structure pass. Existing bundle-size advisory remains. React Doctor: 100/100, no findings. No CI job started.

Initial failures remain private: obsolete navigation assertions, breadcrumb alignment, HTTP-fixture TLS mismatch, Safari square sizing and scanner wrapper instrumentation. Corrected layout/expectations. Scanner test now verifies actual track state is ended; scanner code is unchanged. The HTTP fixture removes only `upgrade-insecure-requests`; production CSP is untouched. An exploratory alignment assertion incorrectly assumed two columns at tablet width; correction checks actual side-by-side geometry. Screenshot capture awaiting lazy off-screen images was stopped and repeated with eager-image decoding.

## Limits

The preview uses isolated fixture data. No production release, live business mutation, actual device qualification, assistive-technology/user study or provider verification occurred. Earlier production and broader-suite receipts remain historical. No product gate advanced.
