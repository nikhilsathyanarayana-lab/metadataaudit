import { app_names } from '../API/app_names.js';

const createVisitorMetadataRow = ({ subId, appId, appName }) => {
  const row = document.createElement('tr');

  const buildCell = (text = '') => {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  };

  row.append(
    buildCell(subId || 'Unknown SubID'),
    buildCell(appName || appId || 'Unknown app'),
    buildCell(appId || ''),
    buildCell('—'),
    buildCell('—'),
    buildCell('—'),
  );

  return row;
};

// Populate visitor metadata table with discovered apps.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const tableBody = sectionRoot?.querySelector('#visitor-metadata-table-body');

  await app_names(undefined, { tableBody, rowBuilder: createVisitorMetadataRow });
}
