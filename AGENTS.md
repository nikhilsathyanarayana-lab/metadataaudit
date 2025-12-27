# AGENTS Instructions

## Project overview
- Front-end stack: HTML, CSS, and vanilla JavaScript. CDN dependencies include `exceljs` and `file-saver`.
- Hosting: Runs on GitHub Pages for the integration workflow. Cookie-based requests rely on `proxy.php` (PHP + cURL) when exercised locally.
- Both the Integration API flow and the SPA rebuild deliver similar capabilities but should be treated as distinct apps when documenting or hosting updates, and anything associated with the SPA should stay under `root/SPA/`.

## Repository conventions
- Use only the `main` branch unless explicitly directed otherwise.
- Keep files small and easy to reference.
- Elements should be clear/concise with logical IDs.
- Temporary features may be added during the build; ensure they are easy to remove cleanly.
- Clear/delete `localStorage` and any residual data after runs complete.
- Never expose API keys or secrets in exports or code.
- Favor open-source client libraries; avoid proprietary SDKs without explicit human approval.
- Agents should **not create or update tests** unless explicitly directed by a human user.
- New libraries or imports require human approval. When proposing one, offer alternatives with pros/cons before coding.
- Preserve browser responsiveness when handling large datasets: use async patterns to avoid blocking the UI.
- Surface specific API errors via console logging for debugging and diagnostics.
- Documentation style: keep inline comments clear and concise, focused on what a function can do. README content should be thorough—describe context, which page(s) the function runs on, inputs, and expected output structure.
- Add a short, concise comment for every new function summarizing its purpose.

## Workflow expectations
- Standard flow: request → questions → code suggestions → GitHub PR.
- For front-end changes impacting visuals, provide a screenshot when feasible.
- Start using `jslint` as the default linter and run it locally to catch style or syntax issues before submitting changes.
- After every feature change, update the README to keep the documented behavior in sync with the implementation.
