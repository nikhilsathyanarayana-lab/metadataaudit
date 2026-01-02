const excelPreviewSources = ['SPA/excel/excel0.html', 'SPA/excel/excel1.html'];
let excelPreviewIndex = 0;

// Update the iframe to show the selected Excel preview source.
const setExcelPreviewSource = (frame, nextIndex, tabList) => {
  if (!frame || !excelPreviewSources.length) {
    return;
  }

  excelPreviewIndex = (nextIndex + excelPreviewSources.length) % excelPreviewSources.length;
  frame.src = excelPreviewSources[excelPreviewIndex];
  updateActiveTab(tabList, excelPreviewIndex);
};

// Mark the active Excel preview tab button.
const updateActiveTab = (tabList, activeIndex) => {
  if (!tabList) {
    return;
  }

  const tabButtons = tabList.querySelectorAll('.export-tab-button');

  tabButtons.forEach((tabButton, index) => {
    const isActive = index === activeIndex;
    tabButton.classList.toggle('is-active', isActive);
    tabButton.setAttribute('aria-selected', isActive);
    tabButton.tabIndex = isActive ? 0 : -1;
  });
};

// Build tab buttons for each available Excel preview source.
const renderExcelTabs = (tabList, frame) => {
  if (!tabList || !frame) {
    return;
  }

  tabList.innerHTML = '';

  excelPreviewSources.forEach((source, index) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'export-tab-button';
    tabButton.id = `excel-tab-${index}`;
    tabButton.role = 'tab';
    tabButton.textContent = `Sheet ${index + 1}`;
    tabButton.setAttribute('aria-controls', 'excel-preview-frame');
    tabButton.addEventListener('click', () => {
      setExcelPreviewSource(frame, index, tabList);
    });

    tabList.append(tabButton);
  });
};

// Initialize Excel preview navigation for the SPA page five view.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#excel-preview-frame');
  const tabList = sectionElement?.querySelector('#excel-tab-strip');
  const excludeTabsButton = sectionElement?.querySelector('#excel-exclude-tabs-button');
  const downloadButton = sectionElement?.querySelector('#excel-download-button');

  if (!previewFrame) {
    return;
  }

  const startingSource = previewFrame.getAttribute('src');
  const startingIndex = excelPreviewSources.findIndex((source) => source === startingSource);

  if (startingIndex >= 0) {
    excelPreviewIndex = startingIndex;
  } else {
    setExcelPreviewSource(previewFrame, 0, tabList);
  }

  renderExcelTabs(tabList, previewFrame);
  updateActiveTab(tabList, excelPreviewIndex);

  excludeTabsButton?.addEventListener('click', () => {
    const excludeTabsEvent = new CustomEvent('excelTabsExcludeRequested', {
      detail: { activeTabIndex: excelPreviewIndex },
    });

    sectionElement.dispatchEvent(excludeTabsEvent);
  });

  downloadButton?.addEventListener('click', () => {
    const downloadEvent = new CustomEvent('excelDownloadRequested', {
      detail: { activeTabIndex: excelPreviewIndex },
    });

    sectionElement.dispatchEvent(downloadEvent);
  });
}
