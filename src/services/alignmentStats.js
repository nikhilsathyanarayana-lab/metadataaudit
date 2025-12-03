const normalizeFields = (fields) => {
  if (!Array.isArray(fields)) {
    return [];
  }

  const uniqueFields = Array.from(new Set(fields.filter((field) => typeof field === 'string' && field.trim())));
  uniqueFields.sort((a, b) => a.localeCompare(b));
  return uniqueFields;
};

const buildFieldKey = (fields) => normalizeFields(fields).join('||');

export const calculateAlignmentStats = (records = [], { fieldKey = 'visitorFields', windowDays = 7 } = {}) => {
  const normalizedRecords = Array.from(records || []).filter(
    (record) => record && (!windowDays || record.windowDays === windowDays),
  );

  const totalApps = normalizedRecords.length;

  if (!totalApps) {
    return { alignedCount: 0, misalignedCount: 0, alignedPercentage: 0, totalApps: 0, canonicalFields: [] };
  }

  const countsByFieldKey = new Map();
  let canonicalKey = '';
  let highestCount = 0;

  normalizedRecords.forEach((record) => {
    const candidateFields = record?.[fieldKey] || [];
    const key = buildFieldKey(candidateFields);

    const updatedCount = (countsByFieldKey.get(key)?.count || 0) + 1;
    countsByFieldKey.set(key, { count: updatedCount, fields: normalizeFields(candidateFields) });

    if (updatedCount > highestCount) {
      canonicalKey = key;
      highestCount = updatedCount;
    }
  });

  const alignedCount = highestCount;
  const misalignedCount = Math.max(0, totalApps - alignedCount);
  const alignedPercentage = Math.round((alignedCount / totalApps) * 100);
  const canonicalFields = countsByFieldKey.get(canonicalKey)?.fields || [];

  return { alignedCount, misalignedCount, alignedPercentage, totalApps, canonicalFields };
};
