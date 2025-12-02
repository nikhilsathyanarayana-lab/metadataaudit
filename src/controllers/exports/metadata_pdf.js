import {
  applyInlineStyles,
  createTableElement,
  loadPdfLibraries,
  shouldUseWideLayout,
} from './pdf_shared.js';

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

const buildCoverPage = (subscriptions) => {
  const cover = document.createElement('section');
  cover.className = 'pdf-cover-page';
  applyInlineStyles(cover, {
    background: 'linear-gradient(120deg, #f557a6 0%, #e0006c 100%)',
    color: '#ffffff',
    borderRadius: '18px',
    boxShadow: '0 14px 42px rgba(224, 0, 108, 0.25)',
    padding: '1.75rem 1.5rem',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gap: '1.5rem',
  });

  const heading = document.createElement('p');
  heading.className = 'pdf-cover-title';
  heading.textContent = 'Metadata export';
  applyInlineStyles(heading, {
    margin: '0',
    fontSize: '0.95rem',
    fontWeight: '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  });

  const brand = document.createElement('div');
  brand.className = 'pdf-cover-brand';
  brand.textContent = 'Pendo';
  applyInlineStyles(brand, {
    fontWeight: '800',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '0.75rem 1rem',
    border: '2px solid rgba(255, 255, 255, 0.75)',
    borderRadius: '16px',
    textAlign: 'center',
    minWidth: '96px',
  });

  const copy = document.createElement('div');
  copy.className = 'pdf-cover-copy';

  const title = document.createElement('h1');
  title.textContent = 'Metadata Fields Export';
  applyInlineStyles(title, {
    margin: '0 0 0.35rem 0',
    fontSize: '1.9rem',
    color: '#ffffff',
  });

  const subtitle = document.createElement('p');
  subtitle.className = 'pdf-cover-subtitle';
  subtitle.textContent = 'Visitor and account metadata pulled directly from your selections.';
  applyInlineStyles(subtitle, {
    margin: '0 0 0.9rem 0',
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '1rem',
  });

  const listHeading = document.createElement('p');
  listHeading.className = 'pdf-cover-list-heading';
  listHeading.textContent = 'Subscriptions included';
  applyInlineStyles(listHeading, {
    margin: '0 0 0.35rem 0',
    fontWeight: '700',
    letterSpacing: '0.02em',
  });

  const list = document.createElement('ul');
  list.className = 'pdf-cover-sub-list';
  applyInlineStyles(list, {
    margin: '0',
    paddingLeft: '1.2rem',
    color: 'rgba(255, 255, 255, 0.92)',
    display: 'grid',
    gap: '0.2rem',
  });

  const uniqueSubs = subscriptions.length ? subscriptions : ['None provided'];
  uniqueSubs.forEach((subId) => {
    const li = document.createElement('li');
    li.textContent = subId || 'Unknown';
    list.appendChild(li);
  });

  copy.append(title, subtitle, listHeading, list);
  const date = document.createElement('p');
  date.className = 'pdf-cover-date';
  date.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
  applyInlineStyles(date, {
    margin: '0.25rem 0 0 0',
    fontWeight: '700',
    letterSpacing: '0.04em',
    textAlign: 'right',
    gridColumn: '1 / -1',
  });

  cover.append(heading, brand, copy, date);
  return cover;
};

const buildSubscriptionHero = (subId) => {
  const header = document.createElement('header');
  header.className = 'pdf-subscription-hero';
  applyInlineStyles(header, {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '1rem',
    alignItems: 'center',
    padding: '1.2rem 1.4rem',
    background: 'linear-gradient(135deg, #f557a6 0%, #e0006c 100%)',
    color: '#ffffff',
    borderRadius: '14px',
    boxShadow: '0 12px 40px rgba(224, 0, 108, 0.22)',
    marginBottom: '1rem',
  });

  const brand = document.createElement('div');
  brand.className = 'pdf-hero-brand';
  brand.textContent = 'Pendo';
  applyInlineStyles(brand, {
    fontWeight: '800',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '0.6rem 0.9rem',
    border: '2px solid rgba(255, 255, 255, 0.65)',
    borderRadius: '12px',
    textAlign: 'center',
  });

  const copy = document.createElement('div');
  copy.className = 'pdf-hero-copy';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'pdf-hero-eyebrow';
  eyebrow.textContent = 'Metadata Audit Export';
  applyInlineStyles(eyebrow, {
    margin: '0 0 0.25rem 0',
    fontSize: '0.85rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
  });

  const title = document.createElement('h2');
  title.textContent = `Metadata Fields — Subscription ${subId || 'Unknown'}`;
  applyInlineStyles(title, {
    margin: '0',
    fontSize: '1.35rem',
    color: '#ffffff',
  });

  const subtitle = document.createElement('p');
  subtitle.className = 'pdf-hero-subtitle';
  subtitle.textContent = 'Visitor and account metadata with deep-dive details';
  applyInlineStyles(subtitle, {
    margin: '0.2rem 0 0 0',
    color: 'rgba(255, 255, 255, 0.9)',
  });

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
    section.dataset.subscriptionId = subscription.subId || 'Unknown';

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
  await loadPdfLibraries();

  const printable = buildPrintableDocument();
  const wideLayout = shouldUseWideLayout(printable);
  const margin = wideLayout ? 20 : 18;
  const pdf = new window.jspdf.jsPDF(wideLayout ? 'l' : 'p', 'pt', 'a4');
  const pageWidthPt = pdf.internal.pageSize.getWidth();
  const ptToPx = (points) => (points * 96) / 72;
  const availableWidthPx = ptToPx(pageWidthPt - margin * 2);
  const renderWidth = Math.floor(availableWidthPx);
  const baseScale = wideLayout ? 1.4 : 1.5;
  const widthRatio = renderWidth / (wideLayout ? 1200 : 1000);
  const canvasScale = Math.min(2, Math.max(1.2, baseScale * widthRatio));

  printable.style.position = 'fixed';
  printable.style.top = '0';
  printable.style.left = '-9999px';
  printable.style.setProperty('--pdf-render-width', `${renderWidth}px`);
  printable.style.setProperty('--pdf-render-padding', `${ptToPx(margin)}px`);
  printable.style.width = '100%';
  printable.style.maxWidth = 'var(--pdf-render-width)';
  printable.style.background = '#ffffff';
  printable.style.padding = 'var(--pdf-render-padding)';
  printable.style.boxSizing = 'border-box';
  printable.style.overflowX = 'auto';

  document.body.appendChild(printable);
  const sections = Array.from(printable.children);
  const pageDecorations = [];

  const renderSectionWithHeader = async (section, headerText) => {
    const startPage = pdf.internal.getNumberOfPages();

    await pdf.html(section, {
      margin,
      autoPaging: 'text',
      html2canvas: { scale: canvasScale, useCORS: true, backgroundColor: '#ffffff' },
      windowWidth: renderWidth,
      x: margin,
      y: margin,
      pagebreak: { mode: ['css', 'legacy'] },
    });

    const endPage = pdf.internal.getNumberOfPages();
    pageDecorations.push({ startPage, endPage, headerText });
  };

  const cover = sections.shift();
  if (cover) {
    await renderSectionWithHeader(cover, 'Metadata Fields Export');
  }

  for (const section of sections) {
    const subId = section.dataset.subscriptionId || 'Unknown';
    await renderSectionWithHeader(section, `Subscription ${subId}`);
  }

  const totalPages = pdf.internal.getNumberOfPages();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();

  pageDecorations.forEach(({ startPage, endPage, headerText }) => {
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pdf.setPage(pageNumber);
      pdf.setFontSize(10);
      pdf.text(headerText, margin, 20);
      pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 14, { align: 'right' });
    }
  });

  printable.remove();

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
