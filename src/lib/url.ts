const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-absolute path (e.g. "/problems/x/") with the GitHub Pages base path. */
export const url = (path: string) => `${base}${path}`;
