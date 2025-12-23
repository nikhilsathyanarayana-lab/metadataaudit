import { app_names } from '../API/app.js';

export async function initSection() {
  const credentialEntries = Array.isArray(window?.appCredentials) ? window.appCredentials : [];
  app_names(credentialEntries);
}
