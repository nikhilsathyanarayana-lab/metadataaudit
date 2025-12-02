import { metadata_accounts, metadata_visitors } from '../../pages/deepDive/aggregation.js';

export const downloadDeepDiveJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
};

export const exportDeepDiveJson = () => {
  downloadDeepDiveJson(metadata_visitors, 'metadata-deep-dive-visitors.json');
  downloadDeepDiveJson(metadata_accounts, 'metadata-deep-dive-accounts.json');
};
