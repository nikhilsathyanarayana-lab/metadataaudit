import { loadTemplate } from '../controllers/modalLoader.js';
import { exportMetadataPdf } from '../controllers/pdfExport.js';

const initExportModal = () => {
  const exportButton = document.getElementById('export-button');
  const modal = document.getElementById('export-modal');
  const backdrop = document.getElementById('export-backdrop');

  if (!exportButton || !modal || !backdrop) {
    return;
  }

  const closeButtons = modal.querySelectorAll('[data-close-modal]');
  const formatButtons = modal.querySelectorAll('[data-format]');

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
      if (format === 'pdf') {
        await exportMetadataPdf();
      } else {
        console.info(`Export selected: ${format?.toUpperCase()}`);
      }
      closeModal();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });
};

export const bootstrapShared = async () => {
  const exportButton = document.getElementById('export-button');

  if (!exportButton) {
    return;
  }

  if (!document.getElementById('export-modal')) {
    await loadTemplate('Modals/export-modal.html');
  }

  initExportModal();
};
