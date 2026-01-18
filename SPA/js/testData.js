// Build a minimal field bucket matching metadata aggregation counts.
const buildFieldBucket = (values = []) => {
  const counts = {};

  values.forEach((value) => {
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;
  });

  return {
    values: counts,
    total: values.length,
  };
};

// Build a processed window bucket for metadata aggregation previews.
const buildWindowBucket = (lookbackWindow, namespaces, recordsScanned) => {
  return {
    lookbackWindow,
    namespaces,
    timeseriesStart: '2024-08-01T00:00:00Z',
    isProcessed: true,
    recordsScanned,
    nonNullRecordsByNamespace: {
      visitor: recordsScanned,
      account: recordsScanned,
      custom: recordsScanned,
      salesforce: recordsScanned,
    },
  };
};

export const TEST_DATASET = {
  appCredentials: [
    {
      subId: 'sub-1001',
      domain: 'example.mixpanel.com',
      integrationKey: 'int-key-001',
    },
    {
      subId: 'sub-1002',
      domain: 'analytics.example.com',
      integrationKey: 'int-key-002',
    },
  ],
  appSelectionState: {
    entries: [
      {
        subId: 'sub-1001',
        appId: 'app-01',
        appName: 'Signup Flow',
        isSelected: true,
      },
      {
        subId: 'sub-1001',
        appId: 'app-02',
        appName: 'Checkout',
        isSelected: false,
      },
      {
        subId: 'sub-1002',
        appId: 'app-03',
        appName: 'Onboarding',
        isSelected: true,
      },
    ],
  },
  appListingResults: [
    {
      credential: {
        subId: 'sub-1001',
        domain: 'example.mixpanel.com',
        integrationKey: 'int-key-001',
      },
      results: [
        { appId: 'app-01', appName: 'Signup Flow' },
        { appId: 'app-02', appName: 'Checkout' },
      ],
    },
    {
      credential: {
        subId: 'sub-1002',
        domain: 'analytics.example.com',
        integrationKey: 'int-key-002',
      },
      results: [
        { appId: 'app-03', appName: 'Onboarding' },
      ],
    },
  ],
  appCountsBySubId: {
    'sub-1001': { total: 2, distinct: 2 },
    'sub-1002': { total: 1, distinct: 1 },
  },
  fieldTypeSelections: {
    'visitor.email': { type: 'email' },
    'account.plan': { regex: '^(free|pro)$' },
  },
  metadataAggregations: {
    'sub-1001': {
      apps: {
        'app-01': {
          appId: 'app-01',
          appName: 'Signup Flow',
          timeseriesStart: '2024-08-01T00:00:00Z',
          lookbackWindow: 7,
          recordsScanned: 6,
          nonNullRecordsByNamespace: {
            visitor: 6,
            account: 2,
            custom: 1,
            salesforce: 0,
          },
          windows: {
            7: buildWindowBucket(7, {
              visitor: {
                email: buildFieldBucket(['user@example.com']),
                country: buildFieldBucket(['US']),
              },
              account: {
                plan: buildFieldBucket(['pro']),
              },
              custom: {
                abGroup: buildFieldBucket(['B']),
              },
              salesforce: {},
            }, 3),
            23: buildWindowBucket(23, {
              visitor: {
                email: buildFieldBucket(['user@example.com']),
                referrer: buildFieldBucket(['google']),
              },
              account: {
                plan: buildFieldBucket(['pro']),
                renewalDate: buildFieldBucket(['2024-09-01']),
              },
              custom: {
                abGroup: buildFieldBucket(['B']),
              },
              salesforce: {
                leadStatus: buildFieldBucket(['Open']),
              },
            }, 2),
            150: buildWindowBucket(150, {
              visitor: {
                email: buildFieldBucket(['user@example.com']),
                device: buildFieldBucket(['mobile']),
              },
              account: {
                plan: buildFieldBucket(['pro']),
              },
              custom: {
                abGroup: buildFieldBucket(['B']),
                campaign: buildFieldBucket(['launch']),
              },
              salesforce: {
                leadStatus: buildFieldBucket(['Open']),
              },
            }, 1),
          },
        },
        'app-02': {
          appId: 'app-02',
          appName: 'Checkout',
          timeseriesStart: '2024-08-01T00:00:00Z',
          lookbackWindow: 7,
          recordsScanned: 3,
          nonNullRecordsByNamespace: {
            visitor: 3,
            account: 1,
            custom: 0,
            salesforce: 0,
          },
          windows: {
            7: buildWindowBucket(7, {
              visitor: {
                email: buildFieldBucket(['buyer@example.com']),
                cartSize: buildFieldBucket(['2']),
              },
              account: {
                tier: buildFieldBucket(['enterprise']),
              },
              custom: {},
              salesforce: {},
            }, 1),
          },
        },
      },
      recordsScanned: 9,
      nonNullRecordsByNamespace: {
        visitor: 9,
        account: 3,
        custom: 1,
        salesforce: 1,
      },
    },
    'sub-1002': {
      apps: {
        'app-03': {
          appId: 'app-03',
          appName: 'Onboarding',
          timeseriesStart: '2024-08-01T00:00:00Z',
          lookbackWindow: 7,
          recordsScanned: 4,
          nonNullRecordsByNamespace: {
            visitor: 4,
            account: 2,
            custom: 2,
            salesforce: 0,
          },
          windows: {
            7: buildWindowBucket(7, {
              visitor: {
                email: buildFieldBucket(['new@example.com']),
                locale: buildFieldBucket(['en-US']),
              },
              account: {
                plan: buildFieldBucket(['free']),
              },
              custom: {
                cohort: buildFieldBucket(['spring']),
              },
              salesforce: {},
            }, 2),
            23: buildWindowBucket(23, {
              visitor: {
                email: buildFieldBucket(['new@example.com']),
                locale: buildFieldBucket(['en-US']),
              },
              account: {
                plan: buildFieldBucket(['free']),
                renewalDate: buildFieldBucket(['2024-09-15']),
              },
              custom: {
                cohort: buildFieldBucket(['spring']),
                activationStep: buildFieldBucket(['invite']),
              },
              salesforce: {},
            }, 2),
            150: buildWindowBucket(150, {
              visitor: {
                email: buildFieldBucket(['new@example.com']),
                locale: buildFieldBucket(['en-US']),
              },
              account: {
                plan: buildFieldBucket(['free']),
              },
              custom: {
                cohort: buildFieldBucket(['spring']),
              },
              salesforce: {},
            }, 1),
          },
        },
      },
      recordsScanned: 4,
      nonNullRecordsByNamespace: {
        visitor: 4,
        account: 2,
        custom: 2,
        salesforce: 0,
      },
    },
  },
};
