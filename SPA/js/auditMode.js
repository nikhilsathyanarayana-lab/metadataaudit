export const AUDIT_MODE_STANDARD = 'standard';
export const AUDIT_MODE_QUICK = 'quick';

const auditModeState = {
  current: AUDIT_MODE_STANDARD,
};

// Persist the current audit mode for SPA page transitions.
export const setAuditMode = (mode) => {
  auditModeState.current = mode === AUDIT_MODE_QUICK
    ? AUDIT_MODE_QUICK
    : AUDIT_MODE_STANDARD;
};

// Read the current audit mode for the active SPA flow.
export const getAuditMode = () => auditModeState.current;

// Return true when the SPA is running the quick audit flow.
export const isQuickAuditMode = () => getAuditMode() === AUDIT_MODE_QUICK;
