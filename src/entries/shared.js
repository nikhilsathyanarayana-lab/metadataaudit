import { loadTemplate } from '../controllers/modalLoader.js';
import { exportMetadataPdf } from '../controllers/exports/metadata_pdf.js';
import { exportMetadataXlsx } from '../controllers/exports/metadata_xlsx.js';

const initExportModal = (options = {}) => {
  const { enableJsonExport = false, additionalFormats = {}, pdfHandler = exportMetadataPdf } = options;
  const exportButton = document.getElementById('export-button');
  const modal = document.getElementById('export-modal');
  const backdrop = document.getElementById('export-backdrop');

  if (!exportButton || !modal || !backdrop) {
    return;
  }

  const closeButtons = modal.querySelectorAll('[data-close-modal]');
  const jsonButton = modal.querySelector('[data-format="json"]');

  if (jsonButton) {
    if (enableJsonExport) {
      jsonButton.hidden = false;
    } else {
      jsonButton.remove();
    }
  }

  const formatButtons = modal.querySelectorAll('[data-format]');

  const formatHandlers = {
    pdf: pdfHandler,
    xlsx: exportMetadataXlsx,
    ...additionalFormats,
  };

  const openModal = () => {
    modal.hidden = false;
    backdrop.hidden = false;
    modal.classList.add('is-visible');
    backdrop.classList.add('is-visible');
  };

  const closeModal = () => {
    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
  };

  exportButton.addEventListener('click', openModal);
  backdrop.addEventListener('click', closeModal);
  closeButtons.forEach((button) => button.addEventListener('click', closeModal));

  formatButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const format = button.getAttribute('data-format');
      closeModal();

      const handler = formatHandlers[format];

      if (handler) {
        await handler();
        return;
      }

      console.info(`Export selected: ${format?.toUpperCase()}`);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });
};

export const bootstrapShared = async (options = {}) => {
  const exportButton = document.getElementById('export-button');

  if (!exportButton) {
    return;
  }

  if (!document.getElementById('export-modal')) {
    await loadTemplate('Modals/export-modal.html');
  }

  if (!document.getElementById('xlsx-naming-modal')) {
    await loadTemplate('Modals/xlsx-naming-modal.html');
  }

  initExportModal(options);
};
