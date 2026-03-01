# AGENTS Instructions

## Project overview
- Front-end stack: HTML, CSS, and vanilla JavaScript. CDN dependencies include `exceljs` and `file-saver`.
- Both the Integration API flow and the SPA rebuild deliver similar capabilities but should be treated as distinct apps when documenting or hosting updates, and anything associated with the SPA should stay under `SPA/`.
- Current focus: we are working exclusively on the SPA, and all SPA-related changes live under `SPA/` for now.
- Keep SPA-related changes inside `SPA/`, and direct non-SPA updates to their appropriate locations outside that directory.
- One of our core principles is simplicity: write code as plainly as possible and aim for the smallest amount of code needed to meet the goals.

## Repository conventions
- Use only the `main` branch unless explicitly directed otherwise.
- Keep files small and easy to reference.
- When adding or updating markup, use clear, concise IDs that reflect the element purpose and align with existing naming patterns.
- Require every new HTML element to include both a meaningful `id` and a descriptive `class` to support maintainable styling and scripting.
- Temporary features may be added during the build; ensure they are easy to remove cleanly.
- Ensure all customer data is deleted when the browser tab(s) is/are closed out.
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

## Export parity contract (Workbook ↔ Page 5 preview)
- Workbook and preview parity is a required contract for SPA exports. Treat this section as the source of truth.
- Required parity attributes:
  - Headers: bold styling, fill color, text color, and text size must match between workbook and preview.
  - Merged titles: merged section title spans in workbook must render with matching merged structure in preview.
  - Title styling: title rows must preserve shared font/fill/alignment behavior in workbook and preview.
  - Fill and typography: explicit workbook fills, bold/italic/underline, font size, and font color must be reflected in preview.
  - Alignment: horizontal and vertical alignment plus wrap-text behavior must map to equivalent preview rendering.
  - Column sizing: preview must follow workbook column width proportions via the shared conversion constant.
  - Empty-state rows: empty-state messages must render in both workbook and preview as visible text rows.
- Accepted approximations (do not treat as regressions):
  - Exact Excel desktop column pixel rendering vs. browser pixel rendering.
  - Excel-specific font rasterization/line-height behavior vs. browser text layout.
  - Native Excel chrome/gridline differences not explicitly styled by workbook metadata.

## PR Definition of Done for export style changes
- Any PR that changes workbook styling, merge behavior, row role tagging, or Page 5 preview rendering must include a Page 5 preview parity review.
- Review checklist:
  - Confirm required parity attributes in this AGENTS.md section still hold.
  - Confirm observed differences stay within accepted approximations.
  - If a change falls outside accepted approximations, capture it as a parity regression and resolve before merge.

