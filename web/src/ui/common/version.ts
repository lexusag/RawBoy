/**
 * "Version 1.7.0 (8f37634), built 31 Oct 2026, 21:40" for the "?" sheets: the release, the commit and the build time
 * in local time, so an installed app shows whether a newer deploy has reached it (compare with the release notes).
 */
export function versionLabel(version = __RAWBOY_VERSION__, commit = __RAWBOY_COMMIT__, build = __RAWBOY_BUILD__): string {
  const when = new Date(build);
  const built = Number.isNaN(when.getTime()) ? '' : `, built ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  return `Version ${version}${commit ? ` (${commit})` : ''}${built}`;
}
