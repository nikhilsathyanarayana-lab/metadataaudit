// High-level wrapper that documents the deep dive flow while delegating implementation details
// to the modules under src/pages/DeepDive.
//
// Outline of the experience:
// 1) Page bootstraps shared navigation + export handlers, then calls initDeepDive().
// 2) initDeepDive() wires UI controls (lookback selector, modals, start button) and preloads
//    any cached exports via hydrateCachedExportCollections().
// 3) Clicking the start button passes planned scan entries into runDeepDiveScan(), which handles
//    queue preparation, request dispatch, aggregation, and progress tracking.
// 4) Throughout the scan, the call plan in deepDiveCallPlan keeps the UI/debug console in sync,
//    while stageDeepDiveCallPlan() and updateDeepDiveCallPlanStatus() expose structured status
//    updates for each app.
// 5) Exports (JSON/XLSX) rely on the collections hydrated or assembled during the scan.

import {
  API_CALL_TIMEOUT_MS,
  calculateStallThreshold,
  deepDiveCallPlan,
  exportDeepDiveJson,
  exportDeepDiveXlsx,
  hydrateCachedExportCollections,
  initDeepDive,
  runDeepDiveScan,
  stageDeepDiveCallPlan,
  updateDeepDiveCallPlanStatus,
} from './DeepDive/index.js';
import { installDeepDiveGlobalErrorHandlers, reportDeepDiveError } from './deepDive/ui/render.js';

export {
  API_CALL_TIMEOUT_MS,
  calculateStallThreshold,
  deepDiveCallPlan,
  exportDeepDiveJson,
  exportDeepDiveXlsx,
  hydrateCachedExportCollections,
  initDeepDive,
  installDeepDiveGlobalErrorHandlers,
  reportDeepDiveError,
  runDeepDiveScan,
  stageDeepDiveCallPlan,
  updateDeepDiveCallPlanStatus,
};
