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

  const cardSections = document.querySelectorAll('section.card');
  cardSections.forEach((card) => {
    const table = card.querySelector('table');
    if (!table) {
      return;
    }

    const title = card.querySelector('.section-title')?.textContent?.trim();
    const hint = card.querySelector('.section-hint')?.textContent?.trim();
    const tableData = collectTableData(table);
    const printableSection = createTableElement({
      title,
      hint,
      ...tableData,
    });

    container.appendChild(printableSection);
  });

  return container;
};

const renderPdf = async (filename) => {
  await loadLibraries();

  const printable = buildPrintableDocument();
  printable.style.position = 'fixed';
  printable.style.top = '0';
  printable.style.left = '-9999px';
  printable.style.width = '900px';
  printable.style.background = '#ffffff';
  printable.style.padding = '32px';

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
  const margin = 32;

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
