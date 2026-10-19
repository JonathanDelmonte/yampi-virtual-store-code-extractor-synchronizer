// Stands in for the Yampi editor's server in browser tests: the routes the real editor reads,
// answered from the fictitious editor's own state (window.fictitiousServer). Nothing reaches Yampi.
export const SERVER_ORIGIN = 'https://bart.yampi.com.br';
const EDITOR_ORIGIN = 'https://app.yampi.com.br';
// latency: per request, in ms. crlf: keep texts with Windows line endings, as a server may store
// them; the editor shows \n, so the copy must too. unavailable: answer 503 to everything.
export function fictitiousServer({latency = 0, crlf = true, unavailable = false} = {}) {
  const counts = {identity: 0, merchant: 0, file: 0, refused: 0};
  let active = 0, peak = 0;
  async function handle(route) {
    const request = route.request(), url = new URL(request.url());
    const headers = {'access-control-allow-origin': EDITOR_ORIGIN, 'access-control-allow-credentials': 'true', 'content-type': 'application/json', 'cache-control': 'no-store'};
    const answer = (status, data) => route.fulfill({status, headers, body: JSON.stringify(status === 200 ? {data} : {message: 'Resposta fictícia'})});
    // Only reads of the draft, from the editor page, as the real editor makes them.
    if (request.method() !== 'GET' || request.headers().origin !== EDITOR_ORIGIN || url.searchParams.get('preview') !== 'true') {counts.refused++; return answer(405);}
    if (unavailable) return answer(503);
    active++; peak = Math.max(peak, active);
    try {
      if (latency) await new Promise(resolve => setTimeout(resolve, latency));
      const page = request.frame().page(), ask = (name, path) => page.evaluate(([name, path]) => window.fictitiousServer(name, path), [name, path]);
      if (url.pathname === '/v1/merchant/theme/merchant-identity') {counts.identity++; return await answer(200, await ask('identity'));}
      if (url.pathname === '/v1/merchant/theme/data-merchant-theme') {counts.merchant++; return await answer(200, {...await ask('merchant'), expiration: Date.now() + 3_600_000});}
      if (url.pathname === '/v1/merchant/file/get') {
        counts.file++;
        const content = await ask('file', url.searchParams.get('path_file'));
        if (typeof content !== 'string') return await answer(404);
        return await answer(200, crlf && !content.startsWith('data:') ? content.replace(/\r?\n/g, '\r\n') : content);
      }
      counts.refused++; return await answer(404);
    } finally {active--;}
  }
  return {counts, handle, peak: () => peak};
}
