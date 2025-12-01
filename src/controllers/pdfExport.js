const PDF_LIBRARIES = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  jsPDF: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
};

const ensureScript = (key, url) =>
  new Promise((resolve, reject) => {
    if (window[key]) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${key} library`));
    document.head.appendChild(script);
  });

const loadLibraries = async () => {
  await ensureScript('html2canvas', PDF_LIBRARIES.html2canvas);
  await ensureScript('jspdf', PDF_LIBRARIES.jsPDF);
};

const buildDefaultFileName = () => {
  const today = new Date();
  const dateStamp = today.toISOString().slice(0, 10);
  return `metadata_fields-${dateStamp}`;
};

const promptForFileName = () => {
  const defaultName = buildDefaultFileName();
  const userInput = window.prompt('Name your PDF export', defaultName);
  if (userInput === null) {
    return null;
  }

  const trimmed = userInput.trim();
  return trimmed.length ? trimmed.replace(/\.pdf$/i, '') : defaultName;
};

const extractCellValue = (cell) => {
  if (!cell) {
    return '';
  }

  const select = cell.querySelector('select');
  if (select) {
    const selected = select.options[select.selectedIndex];
    return selected?.textContent?.trim() || select.value || '';
  }

  return cell.textContent.trim();
};

const LOOKBACK_WINDOWS = [180, 30, 7];

const parseCount = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
};

const initWindowTotals = () => ({
  180: 0,
  30: 0,
  7: 0,
});

const addCountsToTotals = (totals, counts) => {
  LOOKBACK_WINDOWS.forEach((windowDays) => {
    totals[windowDays] += counts?.[windowDays] || 0;
  });
};

const combineAppIdentifiers = (headers, rows) => {
  const appNameIndex = headers.findIndex((header) => header.toLowerCase() === 'app name');
  const appIdIndex = headers.findIndex((header) => header.toLowerCase() === 'app id');

  if (appNameIndex === -1 || appIdIndex === -1) {
    return { headers, rows };
  }

  const primaryIndex = Math.min(appNameIndex, appIdIndex);
  const removalIndex = appNameIndex === primaryIndex ? appIdIndex : appNameIndex;

  const updatedHeaders = [...headers];
  updatedHeaders.splice(removalIndex, 1);

  const updatedRows = rows.map((row) => {
    const combinedValue = [row[appNameIndex], row[appIdIndex]].filter(Boolean).join('\n');
    const updatedRow = [...row];
    updatedRow[primaryIndex] = combinedValue;
    updatedRow.splice(removalIndex, 1);
    return updatedRow;
  });

  return { headers: updatedHeaders, rows: updatedRows };
};

const collectTableData = (table) => {
  let headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  let rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map(extractCellValue),
  );

  return combineAppIdentifiers(headers, rows);
};

const collectMetadataRows = (table, type) => {
  if (!table) {
    return [];
  }

  const { headers, rows } = collectTableData(table);
  const subIndex = headers.findIndex((header) => header.toLowerCase() === 'sub id');
  const appNameIndex = headers.findIndex((header) => header.toLowerCase().includes('app name'));
  const appIdIndex = headers.findIndex((header) => header.toLowerCase().includes('app id'));
  const windowIndexes = LOOKBACK_WINDOWS.reduce((acc, windowDays) => {
    const idx = headers.findIndex((header) => header.includes(windowDays));
    if (idx !== -1) {
      acc[windowDays] = idx;
    }
    return acc;
  }, {});

  return rows.map((cells) => ({
    subId: subIndex === -1 ? '' : cells[subIndex],
    appName: appNameIndex === -1 ? '' : cells[appNameIndex],
    appId: appIdIndex === -1 ? '' : cells[appIdIndex],
    type,
    counts: LOOKBACK_WINDOWS.reduce(
      (acc, windowDays) => ({
        ...acc,
        [windowDays]: parseCount(cells[windowIndexes[windowDays]]),
      }),
      {},
    ),
  }));
};

const aggregateBySubscription = (visitorRows, accountRows) => {
  const subscriptions = new Map();
  const overallTotals = { visitor: initWindowTotals(), account: initWindowTotals() };

  const addRow = (row) => {
    if (!row) {
      return;
    }

    const { subId, appId, appName, counts, type } = row;
    const existingSub = subscriptions.get(subId) || {
      subId,
      apps: new Map(),
      totals: { visitor: initWindowTotals(), account: initWindowTotals() },
    };

    addCountsToTotals(existingSub.totals[type], counts);

    const existingApp = existingSub.apps.get(appId) || {
      appId,
      appName,
      totals: { visitor: initWindowTotals(), account: initWindowTotals() },
    };

    addCountsToTotals(existingApp.totals[type], counts);

    existingSub.apps.set(appId, existingApp);
    subscriptions.set(subId, existingSub);
    addCountsToTotals(overallTotals[type], counts);
  };

  visitorRows.forEach((row) => addRow(row));
  accountRows.forEach((row) => addRow(row));

  return {
    overallTotals,
    subscriptions: Array.from(subscriptions.values()).map((subscription) => ({
      ...subscription,
      apps: Array.from(subscription.apps.values()),
    })),
  };
};

const buildSubscriptionSummaryRows = (subscriptions) =>
  subscriptions.map((subscription) => [
    subscription.subId || 'Unknown',
    subscription.apps.length,
    LOOKBACK_WINDOWS.map((windowDays) => subscription.totals.visitor[windowDays]).join(' / '),
    LOOKBACK_WINDOWS.map((windowDays) => subscription.totals.account[windowDays]).join(' / '),
  ]);

const buildSubscriptionOverviewRows = (subscription) => [
  ['Visitor', subscription.totals.visitor[180], subscription.totals.visitor[30], subscription.totals.visitor[7]],
  ['Account', subscription.totals.account[180], subscription.totals.account[30], subscription.totals.account[7]],
];

const buildAppBreakdownRows = (subscription) =>
  subscription.apps.flatMap((app) => [
    ['Visitor', app.appName || app.appId || 'Unknown', app.appId || '', app.totals.visitor[180], app.totals.visitor[30], app.totals.visitor[7]],
    ['Account', app.appName || app.appId || 'Unknown', app.appId || '', app.totals.account[180], app.totals.account[30], app.totals.account[7]],
  ]);

const createTableElement = ({ title, hint, headers, rows }) => {
  const section = document.createElement('section');
  section.className = 'pdf-section';

  const heading = document.createElement('h3');
  heading.textContent = title || 'Metadata';
  section.appendChild(heading);

  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'pdf-section-hint';
    hintEl.textContent = hint;
    section.appendChild(hintEl);
  }

  const table = document.createElement('table');
  table.className = 'pdf-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach((headerText) => {
    const th = document.createElement('th');
    th.textContent = headerText;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      td.style.whiteSpace = 'pre-line';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  section.appendChild(table);
  return section;
};

const buildPrintableDocument = () => {
  const container = document.createElement('div');
  container.className = 'pdf-export-root';

  const brandHeader = document.createElement('header');
  brandHeader.className = 'pdf-export-header';
  brandHeader.innerHTML = `
    <div class="pdf-brand-mark">Pendo</div>
    <div class="pdf-title-block">
      <p class="pdf-eyebrow">Metadata audit export</p>
      <h1>${document.title || 'Metadata Export'}</h1>
      <p class="pdf-subtitle">Visitor and account metadata with deep-dive details</p>
    </div>
  `;
  container.appendChild(brandHeader);

  const visitorTable = document.getElementById('visitor-metadata-table');
  const accountTable = document.getElementById('account-metadata-table');

  const visitorRows = collectMetadataRows(visitorTable, 'visitor');
  const accountRows = collectMetadataRows(accountTable, 'account');
  const { overallTotals, subscriptions } = aggregateBySubscription(visitorRows, accountRows);

  const summarySection = createTableElement({
    title: 'Subscription summary',
    hint: 'Totals represent visitor/account metadata across 180 / 30 / 7 days.',
    headers: ['Sub ID', 'App count', 'Visitor totals', 'Account totals'],
    rows: [
      [
        'All subscriptions',
        new Set([...visitorRows, ...accountRows].map((row) => row.appId)).size,
        LOOKBACK_WINDOWS.map((windowDays) => overallTotals.visitor[windowDays]).join(' / '),
        LOOKBACK_WINDOWS.map((windowDays) => overallTotals.account[windowDays]).join(' / '),
      ],
      ...buildSubscriptionSummaryRows(subscriptions),
    ],
  });

  container.appendChild(summarySection);

  subscriptions.forEach((subscription) => {
    const section = document.createElement('section');
    section.className = 'pdf-subscription-section';

    const heading = document.createElement('h2');
    heading.textContent = `Subscription ${subscription.subId || 'Unknown'}`;
    section.appendChild(heading);

    const overviewTable = createTableElement({
      title: 'Metadata overview',
      headers: ['Type', '180 days', '30 days', '7 days'],
      rows: buildSubscriptionOverviewRows(subscription),
    });

    const appBreakdownTable = createTableElement({
      title: 'App breakdown',
      hint: 'Rows list visitor and account metadata totals per app.',
      headers: ['Type', 'App name', 'App ID', '180 days', '30 days', '7 days'],
      rows: buildAppBreakdownRows(subscription),
    });

    section.appendChild(overviewTable);
    section.appendChild(appBreakdownTable);
    container.appendChild(section);
  });

  return container;
};

const renderPdf = async (filename) => {
  await loadLibraries();

  const printable = buildPrintableDocument();
  printable.style.position = 'fixed';
  printable.style.top = '0';
  printable.style.left = '-9999px';
  printable.style.width = '1200px';
  printable.style.maxWidth = 'none';
  printable.style.background = '#ffffff';
  printable.style.padding = '32px';
  printable.style.overflowX = 'auto';

  document.body.appendChild(printable);

  const canvas = await window.html2canvas(printable, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  });

  printable.remove();

  const imageData = canvas.toDataURL('image/png');
  const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 16;

  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imageData, 'PNG', margin, position, imgWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;

  while (heightLeft > 0) {
    pdf.addPage();
    position = heightLeft - imgHeight + margin;
    pdf.addImage(imageData, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }

  const finalName = `${filename || buildDefaultFileName()}.pdf`;
  pdf.save(finalName);
};

export const exportMetadataPdf = async () => {
  const desiredName = promptForFileName();
  if (desiredName === null) {
    return;
  }

  try {
    await renderPdf(desiredName);
  } catch (error) {
    console.error('Unable to generate PDF export', error);
    window.alert('Unable to generate PDF export. Please try again.');
  }
};
