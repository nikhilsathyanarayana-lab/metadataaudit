export const extractAppIds = (apiResponse) => {
  if (!apiResponse) {
    return [];
  }

  const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

  if (Array.isArray(apiResponse)) {
    candidateLists.push(apiResponse);
  }

  const flattened = candidateLists.filter(Array.isArray).flat();

  const appIds = flattened
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return entry;
      }

      if (entry?.appId) {
        return entry.appId;
      }

      return null;
    })
    .filter(Boolean);

  return Array.from(new Set(appIds));
};
