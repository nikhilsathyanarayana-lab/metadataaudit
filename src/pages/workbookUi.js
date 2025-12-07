import { buildAppListingPayload, buildExamplesPayload, buildMetadataFieldsPayload } from '../services/payloads/index.js';
import { buildAggregationUrl, buildCookieHeaderValue, fetchAggregation } from '../services/requests/network.js';
import { extractAppIds } from '../services/appUtils.js';
import { createLogger } from '../utils/logger.js';

const workbookLogger = createLogger('WorkbookUI');

export const parseExamples = (response, subId) => {
  const candidateLists = [];

  if (Array.isArray(response?.results)) {
    candidateLists.push(response.results);
  }

  if (Array.isArray(response?.data)) {
    candidateLists.push(response.data);
  }

  if (Array.isArray(response)) {
    candidateLists.push(response);
  }

  if (Array.isArray(response?.apps)) {
    candidateLists.push(response.apps);
  }

  if (!candidateLists.length) {
    return [];
  }

  const rows = [];

  candidateLists.flat().forEach((record) => {
    const appId = record?.appId || '';
    const fieldExamples = record?.fields || {};
    const accountExamples = record?.account || {};

    Object.entries(fieldExamples).forEach(([field, examples]) => {
      rows.push({
        SubID: subId,
        AppID: appId,
        Field: field,
        Example: examples?.value,
        Count: examples?.count,
      });
    });

    Object.entries(accountExamples).forEach(([key, value]) =>
      rows.push({
        SubID: subId,
        AppID: appId,
        Field: key,
        Example: typeof value === 'string' ? value : JSON.stringify(value),
        Count: '',
      }),
    );

    if (!Object.keys(fieldExamples).length && !Object.keys(accountExamples).length) {
      rows.push({
        SubID: subId,
        AppID: 'n/a',
        Field: 'No examples returned',
        Example: 'Examples were requested but no fields were parsed.',
        Count: '',
      });
    }
  });

  return rows;
};

export const initWorkbookUi = () => {
  const form = document.getElementById('workbook-form');
  const envSelect = document.getElementById('env-choice');
  const subIdInput = document.getElementById('subid-input');
  const workbookNameInput = document.getElementById('workbook-name-input');
  const cookieInput = document.getElementById('cookie-input');
  const daysSelect = document.getElementById('days-window');
  const examplesToggle = document.getElementById('examples-toggle');
  const runButton = document.getElementById('workbook-run');
  const workbookName = document.getElementById('workbook-name');
  const endpointPreview = document.getElementById('endpoint-preview');
  const cookiePreview = document.getElementById('cookie-preview');
  const endpointBlock = document.getElementById('endpoint-block');
  const workbookBlock = document.getElementById('workbook-block');

  if (!form || !envSelect || !subIdInput || !cookieInput || !runButton || !workbookNameInput) {
    return;
  }

  runButton.textContent = 'Run workbook';

  const envUrls = {
    eu: 'https://aggregations-dot-pendo-io.gke.eu.pendo.io/api/s/{sub_id}/aggregation?all=true&cachepolicy=all:ignore',
    us: 'https://aggregations-dot-pendo-io.gke.us.pendo.io/api/s/{sub_id}/aggregation?all=true&cachepolicy=all:ignore',
  };

  const messageRegion = document.querySelector('.page-messages') || (() => {
    const region = document.createElement('div');
    region.className = 'page-messages';

    const content = document.querySelector('main.content');
    content?.parentNode?.insertBefore(region, content);

    return region;
  })();

  messageRegion.id = messageRegion.id || 'workbook-messages';

  const ensureChild = (selector, createNode) => {
    const existing = messageRegion.querySelector(selector);
    if (existing) {
      return existing;
    }

    const node = createNode();
    messageRegion.appendChild(node);
    return node;
  };

  const progressIndicator = ensureChild('#workbook-progress', () => {
    const progress = document.createElement('p');
    progress.id = 'workbook-progress';
    progress.className = 'status-banner';
    progress.textContent = 'Waiting to start the workbook run.';
    return progress;
  });

  const errorAlert = ensureChild('#workbook-errors', () => {
    const alert = document.createElement('p');
    alert.id = 'workbook-errors';
    alert.className = 'alert';
    alert.setAttribute('role', 'alert');
    alert.hidden = true;
    return alert;
  });

  const statusSteps = Array.from(document.querySelectorAll('[data-step]')).reduce((acc, element) => {
    const stepId = element.getAttribute('data-step');

    if (!stepId) {
      return acc;
    }

    const pill = element.querySelector('.status-pill');
    const detail = element.querySelector('[data-status-detail]');

    acc[stepId] = {
      element,
      pill,
      detail,
      defaultDetail: detail?.textContent?.trim() || '',
    };

    return acc;
  }, {});

  const setStatus = (stepId, state, detailText) => {
    const step = statusSteps[stepId];

    if (!step) {
      return;
    }

    step.element.dataset.status = state;

    if (step.pill) {
      const labelMap = {
        pending: 'Pending',
        running: 'Running',
        success: 'Done',
        error: 'Error',
        fail: 'Failed',
      };

      step.pill.textContent = labelMap[state] || 'Pending';
    }

    if (step.detail) {
      step.detail.textContent = detailText || step.defaultDetail;
    }
  };

  const resetStatuses = () => {
    Object.keys(statusSteps).forEach((stepId) => setStatus(stepId, 'pending'));
  };

  const setProgress = (message) => {
    if (progressIndicator) {
      progressIndicator.textContent = message;
    }
  };

  const showMessage = (message, tone = 'error') => {
    if (!messageRegion) {
      return;
    }

    if (tone === 'error' && errorAlert) {
      errorAlert.textContent = message;
      errorAlert.hidden = false;
      return;
    }

    setProgress(message);
  };

  const clearMessage = () => {
    if (errorAlert) {
      errorAlert.hidden = true;
      errorAlert.textContent = '';
    }
  };

  const getWorkbookName = () => {
    const subIdValue = subIdInput.value.trim() || '<sub_id>';
    const workbookValue = workbookNameInput.value.trim();

    return workbookValue || `pendo_metadata_${subIdValue}.xlsx`;
  };

  let previewTimeout;

  const applyPreviews = () => {
    const subIdValue = subIdInput.value.trim() || '<sub_id>';
    const envValue = envSelect.value;

    const endpointTemplate = envUrls[envValue];
    const endpointText = endpointTemplate
      ? endpointTemplate.replace('{sub_id}', subIdValue)
      : 'Select an environment to see the URL';

    const workbookLabel = getWorkbookName();

    workbookName.textContent = workbookLabel;
    workbookBlock.textContent = workbookLabel;
    endpointPreview.textContent = endpointText;
    endpointBlock.textContent = endpointText;
    cookiePreview.textContent = cookieInput.value.trim() ? 'Cookie captured locally' : 'Waiting for cookie';
  };

  const updatePreviews = () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => applyPreviews(), 200);
  };

  const parseMetadataFields = (fieldResponses, subId) => {
    if (!Array.isArray(fieldResponses)) {
      return [];
    }

    const rowsByField = new Map();
    const windowColumns = new Set();

    const getRowForField = (appId, scope, fieldName) => {
      const key = `${appId}|${scope}|${fieldName}`;
      if (!rowsByField.has(key)) {
        rowsByField.set(key, {
          SubID: subId,
          AppID: appId,
          Scope: scope,
          Field: fieldName,
        });
      }

      return rowsByField.get(key);
    };

    fieldResponses.forEach(({ windowDays, response }) => {
      const windowLabel = `Seen in ${windowDays}d`;
      windowColumns.add(windowLabel);

      if (!Array.isArray(response?.results)) {
        return;
      }

      response.results.forEach((record) => {
        const appId = record?.appId ?? '';
        const visitorFields = Array.isArray(record?.visitorFields) ? record.visitorFields : [];
        const accountFields = Array.isArray(record?.accountFields) ? record.accountFields : [];

        visitorFields.forEach((fieldName) => {
          const row = getRowForField(appId, 'Visitor', fieldName);
          row[windowLabel] = (row[windowLabel] || 0) + 1;
        });

        accountFields.forEach((fieldName) => {
          const row = getRowForField(appId, 'Account', fieldName);
          row[windowLabel] = (row[windowLabel] || 0) + 1;
        });
      });
    });

    if (!rowsByField.size) {
      return [
        {
          SubID: subId,
          AppID: 'n/a',
          Field: 'No metadata fields returned',
          Note: 'No visitor or account metadata fields were returned for the requested window(s).',
        },
      ];
    }

    const windowLabels = Array.from(windowColumns);
    rowsByField.forEach((row) => {
      windowLabels.forEach((label) => {
        if (!(label in row)) {
          row[label] = 0;
        }
      });
    });

    return Array.from(rowsByField.values());
  };

  let workbookLibsPromise;

  const loadScript = (src, globalName) =>
    new Promise((resolve, reject) => {
      if (globalName && window[globalName]) {
        resolve(window[globalName]);
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(window[globalName]);
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });

  const ensureWorkbookLibs = () => {
    if (!workbookLibsPromise) {
      workbookLibsPromise = Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'ExcelJS'),
        loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js', 'saveAs'),
      ]);
    }

    return workbookLibsPromise;
  };

  const applyHeaderFormatting = (worksheet) => {
    const headerRow = worksheet.getRow(1);
    if (!headerRow || headerRow.cellCount === 0) {
      return;
    }

    headerRow.eachCell((cell) => {
      cell.font = {
        ...(cell.font || {}),
        bold: true,
        size: 14,
        color: { argb: 'FFE83E8C' },
      };
    });
  };

const summarizeError = (error) => {
    const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const message = rawMessage || 'Unknown workbook error.';
    const lowered = message.toLowerCase();

    if (lowered.includes('jwt2')) {
      return 'Missing or invalid pendo.sess.jwt2 cookie.';
    }

    if (message.trim() === '401' || lowered === 'unauthorized') {
      return 'Authentication failed (401). Check the environment and cookie.';
    }

    if (lowered.includes('failed to fetch') || lowered.includes('network')) {
      return 'Network error while contacting the Aggregations API.';
    }

    return message;
  };

  const markStepFailure = (stepId, error, fallbackDetail) => {
    const summary = summarizeError(error);
    const detail = fallbackDetail ? `${fallbackDetail} ${summary}` : summary;

    const errorDetails =
      error && typeof error === 'object' && 'details' in error && error.details ? error.details : undefined;

    workbookLogger.error('Workbook step failure', {
      stepId,
      error,
      errorDetails,
      fallbackDetail,
    });

    setStatus(stepId, 'fail', detail);
    showMessage(summary, 'error');
    setProgress(`Workbook failed during ${stepId}: ${summary}`);

    return summary;
  };

  const runWorkbook = async () => {
    if (runButton.disabled) {
      return;
    }

    clearMessage();
    resetStatuses();
    setProgress('Running workbook flow…');
    runButton.textContent = 'Running…';
    runButton.disabled = true;
    runButton.setAttribute('aria-disabled', 'true');

    let lastErrorSummary = '';

    try {
      const envValue = envSelect.value;
      const subIdValue = subIdInput.value.trim();
      const cookieHeaderValue = buildCookieHeaderValue(cookieInput.value);
      const includeExamples = examplesToggle?.value !== 'off';
      const lookback = Number(daysSelect?.value || '180');

      if (!envValue || !subIdValue || !cookieHeaderValue) {
        const summary = !cookieHeaderValue
          ? 'Missing pendo.sess.jwt2 cookie. Paste the cookie before running.'
          : 'Please provide an environment and Sub ID.';

        setStatus('env', 'fail', summary);
        showMessage(summary, 'error');
        setProgress(`Workbook failed: ${summary}`);
        throw new Error(summary);
      }

      setStatus('env', 'running', 'Resolving aggregation endpoint…');
      const aggregationUrl = buildAggregationUrl(envUrls, envValue, subIdValue);

      if (!aggregationUrl) {
        const summary = 'Unable to resolve the aggregation URL.';
        setStatus('env', 'fail', summary);
        showMessage(summary, 'error');
        setProgress(`Workbook failed: ${summary}`);
        throw new Error(summary);
      }

      setStatus('env', 'success', aggregationUrl);

      setStatus('apps', 'running', 'Discovering appIds via expandAppIds("*").');
      let appsResponse;

      try {
        appsResponse = await fetchAggregation(aggregationUrl, buildAppListingPayload(), cookieHeaderValue, {
          region: envValue,
          subId: subIdValue,
        });
      } catch (error) {
        lastErrorSummary = markStepFailure('apps', error, 'App discovery failed.');
        throw error;
      }

      const appIds = extractAppIds(appsResponse);

      if (!appIds.length) {
        const summary = 'No appIds were returned from the aggregation API.';
        setStatus('apps', 'fail', 'No apps returned for this Sub ID.');
        showMessage(summary, 'error');
        setProgress(`Workbook failed: ${summary}`);
        lastErrorSummary = summary;
        throw new Error(summary);
      }

      setStatus('apps', 'success', `Found ${appIds.length} app(s) for ${subIdValue}.`);

      setStatus('fields', 'running', `Requesting metadata fields for 7d${lookback !== 7 ? ` and ${lookback}d` : ''}.`);
      const fieldWindows = [7];
      if (lookback !== 7) {
        fieldWindows.push(lookback);
      }

      const fieldResponses = [];

      for (const windowDays of fieldWindows) {
        try {
          const response = await fetchAggregation(
            aggregationUrl,
            buildMetadataFieldsPayload(windowDays),
            cookieHeaderValue,
            {
              region: envValue,
              subId: subIdValue,
            },
          );
          fieldResponses.push({ windowDays, response });
        } catch (error) {
          lastErrorSummary = markStepFailure(
            'fields',
            error,
            `Metadata field fetch failed for the ${windowDays} day window.`,
          );
          throw error;
        }
      }

      setStatus('fields', 'success', `Collected metadata fields for ${fieldWindows.join(' & ')} days.`);

      let examplesRows = [];

      if (includeExamples) {
        setStatus('meta', 'running', 'Requesting metadata value examples.');
        try {
          const examplesResponse = await fetchAggregation(aggregationUrl, buildExamplesPayload(), cookieHeaderValue, {
            region: envValue,
            subId: subIdValue,
          });
          examplesRows = parseExamples(examplesResponse, subIdValue);
          setStatus('meta', 'success', `Parsed ${examplesRows.length} example rows.`);
        } catch (error) {
          lastErrorSummary = markStepFailure('meta', error, 'Example metadata fetch failed.');
          throw error;
        }
      } else {
        setStatus('meta', 'success', 'Skipped meta event examples per settings.');
      }

      const fieldsRows = parseMetadataFields(fieldResponses, subIdValue);

      setStatus('excel', 'running', 'Building workbook…');
      await ensureWorkbookLibs();

      const workbook = new ExcelJS.Workbook();
      const addSheet = (label, rows, fallbackMessage) => {
        const worksheet = workbook.addWorksheet(label);
        const effectiveRows = rows.length ? rows : [{ Note: fallbackMessage }];

        const headers = Object.keys(effectiveRows[0]);
        worksheet.addRow(headers);
        effectiveRows.forEach((row) => worksheet.addRow(headers.map((header) => row[header] ?? '')));
        applyHeaderFormatting(worksheet);
      };

      addSheet('Fields', fieldsRows, 'No metadata fields returned from the Aggregations API.');

      const examplesRowsToWrite = includeExamples
        ? examplesRows.length
          ? examplesRows
          : [{ Note: 'Examples were requested but no values were parsed.' }]
        : [{ Note: 'Examples were skipped per settings.' }];
      addSheet('Examples', examplesRowsToWrite, 'Examples were skipped per settings.');

      const workbookLabel = getWorkbookName();
      const normalizedWorkbookLabel = workbookLabel.toLowerCase().endsWith('.xlsx')
        ? workbookLabel
        : `${workbookLabel}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        normalizedWorkbookLabel,
      );

      setStatus('excel', 'success', `Workbook ready: ${workbookLabel}`);
      showMessage(`Workbook downloaded as ${workbookLabel}.`, 'info');
      setProgress(`Workbook downloaded as ${workbookLabel}.`);
    } catch (error) {
      workbookLogger.error('Workbook run failed:', error);
      const message = summarizeError(error);
      lastErrorSummary = lastErrorSummary || message;
      showMessage(message, 'error');
      setProgress(`Workbook failed: ${message}`);

      ['env', 'apps', 'fields', 'meta', 'excel'].forEach((stepId) => {
        const step = statusSteps[stepId];
        if (step?.element.dataset.status === 'running' || step?.element.dataset.status === 'pending') {
          setStatus(stepId, 'fail', message);
        }
      });
    } finally {
      const truncatedError = lastErrorSummary && lastErrorSummary.length > 90
        ? `${lastErrorSummary.slice(0, 87)}…`
        : lastErrorSummary;

      runButton.textContent = truncatedError ? `Retry run (${truncatedError})` : 'Run workbook';

      if (truncatedError) {
        runButton.setAttribute('aria-label', `Retry workbook run. Last error: ${truncatedError}`);
      } else {
        runButton.removeAttribute('aria-label');
      }
      runButton.disabled = false;
      runButton.setAttribute('aria-disabled', 'false');
      updatePreviews();
    }
  };

  [envSelect, subIdInput, workbookNameInput, cookieInput, daysSelect, examplesToggle].forEach((element) =>
    element?.addEventListener('input', updatePreviews),
  );

  runButton.addEventListener('click', (event) => {
    event.preventDefault();
    runWorkbook();
  });

  updatePreviews();
};
