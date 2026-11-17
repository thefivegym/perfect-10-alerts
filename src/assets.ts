/**
 * Static assets use the default html_handling, "auto-trailing-slash".
 * A request for "/manage.html" is redirected to "/manage", and "/manage"
 * is what actually serves public/manage.html.
 *
 * With run_worker_first, rewriting "/manage" to "/manage.html" and returning
 * that redirect sends the browser back to "/manage". This worker would
 * rewrite it again. Ask the asset handler for the extensionless path.
 */
export function staticAssetUrl(url: URL): URL {
  const out = new URL(url.href);
  if (out.pathname === '/favicon.ico') {
    out.pathname = '/icons/favicon-32.png';
    return out;
  }
  if (out.pathname.endsWith('.html')) {
    const bare = out.pathname.slice(0, -'.html'.length);
    out.pathname = bare === '/index' ? '/' : bare || '/';
  }
  return out;
}
