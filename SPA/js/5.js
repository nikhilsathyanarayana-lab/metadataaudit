const excelPreviewSources = ['SPA/excel/excel0.html', 'SPA/excel/excel1.html'];
let excelPreviewIndex = 0;

// Update the iframe to show the selected Excel preview source.
const setExcelPreviewSource = (frame, nextIndex) => {
  if (!frame || !excelPreviewSources.length) {
    return;
  }

  excelPreviewIndex = (nextIndex + excelPreviewSources.length) % excelPreviewSources.length;
  frame.src = excelPreviewSources[excelPreviewIndex];
};

// Initialize Excel preview navigation for the SPA page five view.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#excel-preview-frame');
  const prevButton = sectionElement?.querySelector('#excel-nav-prev');
  const nextButton = sectionElement?.querySelector('#excel-nav-next');

  if (!previewFrame || !prevButton || !nextButton) {
    return;
  }

  const startingSource = previewFrame.getAttribute('src');
  const startingIndex = excelPreviewSources.findIndex((source) => source === startingSource);

  if (startingIndex >= 0) {
    excelPreviewIndex = startingIndex;
  } else {
    setExcelPreviewSource(previewFrame, 0);
  }

  prevButton.addEventListener('click', () => {
    setExcelPreviewSource(previewFrame, excelPreviewIndex - 1);
  });

  nextButton.addEventListener('click', () => {
    setExcelPreviewSource(previewFrame, excelPreviewIndex + 1);
  });
}
