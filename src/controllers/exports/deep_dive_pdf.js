import { loadAppSelections, loadDeepDiveRecords, loadMetadataRecords } from '../../pages/deepDive/dataHelpers.js';
import { loadPdfLibraries } from './pdf_shared.js';

const collectSubIds = () => {
  const deduped = new Set();

  const append = (value) => {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      deduped.add(trimmed);
    }
  };

  loadDeepDiveRecords().forEach((record) => append(record.subId));
  loadMetadataRecords().forEach((record) => append(record.subId));

  const appSelections = loadAppSelections?.();
  if (Array.isArray(appSelections)) {
    appSelections.forEach((selection) => append(selection.subId));
  }

  return Array.from(deduped).sort((first, second) => first.localeCompare(second));
};

const buildSubIdList = (subIds) => {
  const subhead = document.createElement('div');
  subhead.className = 'deep-dive-pdf__subhead';

  const heading = document.createElement('p');
  heading.className = 'deep-dive-pdf__subhead-title';
  heading.textContent = 'Sub IDs included';

  const list = document.createElement('ul');
  list.className = 'deep-dive-pdf__sub-list';

  if (!subIds.length) {
    const placeholder = document.createElement('li');
    placeholder.className = 'deep-dive-pdf__sub-list-empty';
    placeholder.textContent = 'No Sub IDs captured yet.';
    list.appendChild(placeholder);
  } else {
    subIds.forEach((subId) => {
      const item = document.createElement('li');
      item.textContent = subId;
      list.appendChild(item);
    });
  }

  subhead.append(heading, list);
  return subhead;
};

const buildCoverPage = (subIds) => {
  const cover = document.createElement('section');
  cover.className = 'deep-dive-pdf__cover';

  const title = document.createElement('h1');
  title.className = 'deep-dive-pdf__title';
  title.textContent = 'Metadata Deep Dive';

  const lede = document.createElement('p');
  lede.className = 'deep-dive-pdf__lede';
  lede.textContent = 'Export-ready overview of your deep dive metadata selections.';

  cover.append(title, lede, buildSubIdList(subIds));
  return cover;
};

const buildPlaceholderSection = (title, message) => {
  const section = document.createElement('section');
  section.className = 'deep-dive-pdf__section';

  const heading = document.createElement('h2');
  heading.className = 'deep-dive-pdf__section-title';
  heading.textContent = title;

  const hint = document.createElement('p');
  hint.className = 'deep-dive-pdf__section-hint';
  hint.textContent = message;

  section.append(heading, hint);
  return section;
};

export const exportDeepDivePdf = async () => {
  await loadPdfLibraries();

  const subIds = collectSubIds();

  const container = document.createElement('div');
  container.className = 'deep-dive-pdf';

  container.append(
    buildCoverPage(subIds),
    buildPlaceholderSection('Overview', 'PDF export scaffolding is ready to receive deep dive content.'),
    buildPlaceholderSection('Metadata details', 'Populate sections with visitor and account deep dive tables.'),
  );

  console.info('Deep dive PDF export scaffolding created.', container);
  return container;
};
