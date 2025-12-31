# AGENTS Instructions

## Project overview
- Front-end stack: HTML, CSS, and vanilla JavaScript. CDN dependencies include `exceljs` and `file-saver`.
- Both the Integration API flow and the SPA rebuild deliver similar capabilities but should be treated as distinct apps when documenting or hosting updates, and anything associated with the SPA should stay under `root/SPA/`.
- Current focus: we are working exclusively on the SPA, and all SPA-related changes live under `root/SPA/` for now.
- One of our core principles is simplicity: write code as plainly as possible and aim for the smallest amount of code needed to meet the goals.

## Repository conventions
- Use only the `main` branch unless explicitly directed otherwise.
- Keep files small and easy to reference.
- When adding or updating markup, use clear, concise IDs that reflect the element purpose and align with existing naming patterns.
- Require every new HTML element to include both a meaningful `id` and a descriptive `class` to support maintainable styling and scripting.
- Temporary features may be added during the build; ensure they are easy to remove cleanly.
- Clear/delete `localStorage` and any residual data after runs complete.
- SPA storage rule: keep SPA state in memory (for example, module-level variables) and avoid adding new `sessionStorage` or `localStorage` dependencies.
- Never expose API keys or secrets in exports or code.
- Favor open-source client libraries; avoid proprietary SDKs without explicit human approval.
- Agents should **not create or update tests** unless explicitly directed by a human user.
- Preserve browser responsiveness when handling large datasets: use async patterns to avoid blocking the UI.
- Surface specific API errors via console logging for debugging and diagnostics.
- Documentation style: keep inline comments clear and concise, focused on what a function can do. README content should be thorough—describe context, which page(s) the function runs on, inputs, and expected output structure.
- Add a short, concise comment for every new function summarizing its purpose.
- Accessibility scope: postpone detailed ARIA or captioning work unless explicitly requested; focus current efforts on core SPA behavior and documentation.

## Workflow expectations
- Standard flow: request → questions → code suggestions → GitHub PR.
- For front-end changes impacting visuals, provide a screenshot when feasible.
- Start using `jslint` as the default linter and run it locally to catch style or syntax issues before submitting changes.
