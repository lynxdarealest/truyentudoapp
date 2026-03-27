export const APP_VERSION_SEMVER = '0.1.0-b';

export function formatAppVersionLabel(version: string): string {
  const normalized = String(version || '').trim().toLowerCase();
  if (normalized === '0.1.0-b') return '0.1b';
  if (normalized === '0.1.0-a') return '0.1a';
  if (normalized === '0.0.0-a') return '0.0a';
  return normalized || 'dev';
}

export const APP_VERSION_LABEL = formatAppVersionLabel(APP_VERSION_SEMVER);
