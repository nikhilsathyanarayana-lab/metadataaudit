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

const collectTableData = (table) => {
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map(extractCellValue),
  );

  return { headers, rows };
};

const collectMetadataRows = (table, type) => {
  if (!table) {
    return [];
  }

  const { headers, rows } = collectTableData(table);
  const subIndex = headers.findIndex((header) => header.toLowerCase() === 'sub id');
  const subColumn = subIndex === -1 ? null : subIndex;

  return rows.map((cells) => ({
    subId: subColumn === null ? 'Unknown' : cells[subColumn] || 'Unknown',
    type,
    headers,
    cells,
  }));
};

const aggregateBySubscription = (visitorRows, accountRows) => {
  const subscriptions = new Map();

  const addRow = (row) => {
    if (!row) {
      return;
    }

    const existing = subscriptions.get(row.subId) || { subId: row.subId, visitor: [], account: [] };
    existing[row.type].push({ headers: row.headers, cells: row.cells });
    subscriptions.set(row.subId, existing);
  };

  visitorRows.forEach((row) => addRow(row));
  accountRows.forEach((row) => addRow(row));

  return Array.from(subscriptions.values());
};

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

const buildCoverPage = (subscriptions) => {
  const cover = document.createElement('section');
  cover.className = 'pdf-cover-page';

  const brand = document.createElement('div');
  brand.className = 'pdf-cover-brand';
  brand.textContent = 'Pendo';

  const copy = document.createElement('div');
  copy.className = 'pdf-cover-copy';

  const title = document.createElement('h1');
  title.textContent = 'Metadata Fields Export';

  const subtitle = document.createElement('p');
  subtitle.className = 'pdf-cover-subtitle';
  subtitle.textContent = 'Visitor and account metadata pulled directly from your selections.';

  const listHeading = document.createElement('p');
  listHeading.className = 'pdf-cover-list-heading';
  listHeading.textContent = 'Subscriptions included';

  const list = document.createElement('ul');
  list.className = 'pdf-cover-sub-list';

  const uniqueSubs = subscriptions.length ? subscriptions : ['None provided'];
  uniqueSubs.forEach((subId) => {
    const li = document.createElement('li');
    li.textContent = subId || 'Unknown';
    list.appendChild(li);
  });

  copy.append(title, subtitle, listHeading, list);
  cover.append(brand, copy);
  return cover;
};

const buildSubscriptionHero = (subId) => {
  const header = document.createElement('header');
  header.className = 'pdf-subscription-hero';

  const brand = document.createElement('div');
  brand.className = 'pdf-hero-brand';
  brand.textContent = 'Pendo';

  const copy = document.createElement('div');
  copy.className = 'pdf-hero-copy';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'pdf-hero-eyebrow';
  eyebrow.textContent = 'Metadata Audit Export';

  const title = document.createElement('h2');
  title.textContent = `Metadata Fields — Subscription ${subId || 'Unknown'}`;

  const subtitle = document.createElement('p');
  subtitle.className = 'pdf-hero-subtitle';
  subtitle.textContent = 'Visitor and account metadata with deep-dive details';

  copy.append(eyebrow, title, subtitle);
  header.append(brand, copy);
  return header;
};

const createMetadataTable = (title, headers, rows, emptyMessage) => {
  if (!headers?.length) {
    const wrapper = document.createElement('section');
    wrapper.className = 'pdf-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const hint = document.createElement('p');
    hint.className = 'pdf-section-hint';
    hint.textContent = emptyMessage;
    wrapper.append(heading, hint);
    return wrapper;
  }

  const normalizedRows = rows?.length ? rows : [[emptyMessage]];
  return createTableElement({ title, headers, rows: normalizedRows });
};

const buildPrintableDocument = () => {
  const container = document.createElement('div');
  container.className = 'pdf-export-root';

  const visitorTable = document.getElementById('visitor-metadata-table');
  const accountTable = document.getElementById('account-metadata-table');

  const visitorRows = collectMetadataRows(visitorTable, 'visitor');
  const accountRows = collectMetadataRows(accountTable, 'account');

  const subscriptions = aggregateBySubscription(visitorRows, accountRows);
  const subscriptionIds = subscriptions.map((subscription) => subscription.subId);
  container.appendChild(buildCoverPage(subscriptionIds));

  subscriptions.forEach((subscription) => {
    const section = document.createElement('section');
    section.className = 'pdf-subscription-section';

    section.appendChild(buildSubscriptionHero(subscription.subId));

    const visitorHeaders = subscription.visitor[0]?.headers || visitorRows[0]?.headers || [];
    const visitorData = subscription.visitor.map((row) => row.cells);
    const visitorTableSection = createMetadataTable(
      'Visitor metadata fields',
      visitorHeaders,
      visitorData,
      'No visitor metadata found for this subscription.',
    );

    const accountHeaders = subscription.account[0]?.headers || accountRows[0]?.headers || [];
    const accountData = subscription.account.map((row) => row.cells);
    const accountTableSection = createMetadataTable(
      'Account metadata fields',
      accountHeaders,
      accountData,
      'No account metadata found for this subscription.',
    );

    section.append(visitorTableSection, accountTableSection);
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
