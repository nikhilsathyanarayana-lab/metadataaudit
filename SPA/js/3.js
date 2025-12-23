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

const createStatusRow = (message, columnCount = 6, subId = '') => {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.textContent = subId ? `${message} (${subId})` : message;
  row.appendChild(cell);
  return row;
};

const renderVisitorTable = async (tableBody) => {
  tableBody.innerHTML = '';

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    tableBody.appendChild(createStatusRow('No credentials available for app discovery.'));
    return;
  }

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (result?.errorType || !Array.isArray(result?.results)) {
      const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
      tableBody.appendChild(createStatusRow(
        `Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`,
      ));
      return;
    }

    if (!result.results.length) {
      tableBody.appendChild(createStatusRow('No apps returned for SubID.', 6, subId));
      return;
    }

    result.results.forEach((app) => {
      tableBody.appendChild(createVisitorMetadataRow({
        subId,
        appId: app?.appId,
        appName: app?.appName,
      }));
    });
  });
};

// Populate visitor metadata table with discovered apps.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const tableBody = sectionRoot?.querySelector('#visitor-metadata-table-body');

  if (!tableBody) {
    return;
  }

  await renderVisitorTable(tableBody);
}
