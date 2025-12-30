let pdfPageEntry;

// Fetch markup for the first PDF page and initialize its module.
const loadPdfPageOne = async () => {
  const response = await fetch(new URL('../html/pdf1.html', import.meta.url), { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Unable to load PDF page one: ${response.status}`);
  }

  const template = document.createElement('template');
  template.innerHTML = (await response.text()).trim();
  const element = template.content.firstElementChild;

  if (!element) {
    throw new Error('PDF page one markup was empty.');
  }

  const module = await import('./pdf1.js');

  pdfPageEntry = {
    element,
    module,
    initialized: false,
  };
};

// Ensure the overview PDF page exists in the workspace and refresh it.
const renderPdfPageOne = async (sectionRoot) => {
  const workspace = sectionRoot?.querySelector('#pdf-export-workspace');

  if (!workspace) {
    return;
  }

  if (!pdfPageEntry) {
    await loadPdfPageOne();
  }

  workspace.replaceChildren(pdfPageEntry.element);

  if (!pdfPageEntry.initialized && pdfPageEntry.module?.initPdfPage) {
    await pdfPageEntry.module.initPdfPage(pdfPageEntry.element);
    pdfPageEntry.initialized = true;
  }

  if (pdfPageEntry.initialized && pdfPageEntry.module?.onShowPdfPage) {
    await pdfPageEntry.module.onShowPdfPage(pdfPageEntry.element);
  }
};

// Initialize the PDF export section and attach the first page.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  await renderPdfPageOne(sectionRoot);
}

// Refresh the first PDF page when the section becomes visible.
export async function onShow(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  await renderPdfPageOne(sectionRoot);
}
