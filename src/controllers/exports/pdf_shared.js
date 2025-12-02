const PDF_LIBRARIES = {
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  jsPDF: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
};

let pdfLibrariesPromise;

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

export const loadPdfLibraries = async () => {
  if (!pdfLibrariesPromise) {
    pdfLibrariesPromise = (async () => {
      await ensureScript('html2canvas', PDF_LIBRARIES.html2canvas);
      await ensureScript('jspdf', PDF_LIBRARIES.jsPDF);
    })();
  }

  await pdfLibrariesPromise;
};

export const applyInlineStyles = (element, styles = {}) => {
  Object.entries(styles).forEach(([property, value]) => {
    element.style[property] = value;
  });
};

export const deriveColumnWidthClass = (headerText) => {
  const length = headerText.trim().length;
  if (length <= 8) {
    return 'col-tight';
  }

  if (length >= 20) {
    return 'col-wide';
  }

  return 'col-medium';
};

export const createTableElement = ({ title, hint, headers, rows }) => {
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
  const columnWidths = headers.map((headerText) => deriveColumnWidthClass(headerText));

  headers.forEach((headerText, headerIndex) => {
    const th = document.createElement('th');
    th.textContent = headerText;
    th.classList.add(columnWidths[headerIndex]);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((cells) => {
    const tr = document.createElement('tr');
    tr.style.breakInside = 'avoid';
    tr.style.pageBreakInside = 'avoid';
    cells.forEach((value, cellIndex) => {
      const td = document.createElement('td');
      td.textContent = value;
      td.classList.add(columnWidths[cellIndex] || 'col-medium');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  section.appendChild(table);
  return section;
};

export const shouldUseWideLayout = (container) => {
  const tables = Array.from(container.querySelectorAll('.pdf-table'));
  return tables.some((table) => {
    const headers = Array.from(table.querySelectorAll('thead th'));
    const columnCount = headers.length;
    const longestHeader = headers.reduce((max, th) => Math.max(max, th.textContent.trim().length), 0);
    const longestCell = Array.from(table.querySelectorAll('tbody td')).reduce(
      (max, td) => Math.max(max, td.textContent.trim().length),
      0,
    );

    return columnCount >= 9 || longestHeader >= 26 || longestCell >= 200;
  });
};
