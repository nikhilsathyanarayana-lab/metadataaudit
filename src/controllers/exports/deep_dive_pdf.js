import { loadPdfLibraries } from './pdf_shared.js';

const buildCoverPage = () => {
  const cover = document.createElement('section');
  cover.className = 'deep-dive-pdf__cover';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'deep-dive-pdf__eyebrow';
  eyebrow.textContent = 'Metadata deep dive';

  const title = document.createElement('h1');
  title.className = 'deep-dive-pdf__title';
  title.textContent = 'Deep dive export';

  const subtitle = document.createElement('p');
  subtitle.className = 'deep-dive-pdf__subtitle';
  subtitle.textContent = 'Structured PDF export for retention analysis is coming soon.';

  const timestamp = document.createElement('p');
  timestamp.className = 'deep-dive-pdf__timestamp';
  timestamp.textContent = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  cover.append(eyebrow, title, subtitle, timestamp);
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

  const container = document.createElement('div');
  container.className = 'deep-dive-pdf';

  container.append(
    buildCoverPage(),
    buildPlaceholderSection('Overview', 'PDF export scaffolding is ready to receive deep dive content.'),
    buildPlaceholderSection('Metadata details', 'Populate sections with visitor and account deep dive tables.'),
  );

  console.info('Deep dive PDF export scaffolding created.', container);
  return container;
};
