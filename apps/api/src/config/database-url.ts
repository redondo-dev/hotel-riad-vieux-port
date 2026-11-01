/**
 * Describes a database target without its password, for console output and logs:
 * « riad_dev sur db.example.fr:5432 ». The connection URL itself is never printed.
 */
export function describeDatabase(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return '(adresse de base de données illisible)';
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(base par défaut)';
  const port = url.port === '' ? '' : `:${url.port}`;
  return `${name} sur ${url.hostname}${port}`;
}
