// lovelyosd.com's Cloudflare Worker: passes every request on to the Azure app, which on the free plan only answers to
// its azurewebsites address. Deployed by pasting into the Cloudflare dashboard (Workers & Pages), routed on
// lovelyosd.com/* and www.lovelyosd.com/*.
const ORIGIN = 'gitdrone-bxa9ejf9gbhva9ek.westus3-01.azurewebsites.net';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // www goes to the bare domain, so there's one address to share and to rank in search.
    if (url.hostname === 'www.lovelyosd.com') {
      url.hostname = 'lovelyosd.com';
      return Response.redirect(url.toString(), 301);
    }
    const publicHost = url.hostname;
    url.hostname = ORIGIN;
    const headers = new Headers(request.headers);
    // App Service only sees the Worker; the visitor stats count by the real visitor's address.
    headers.set('X-Visitor-IP', request.headers.get('CF-Connecting-IP') ?? '');
    const response = await fetch(url, { method: request.method, headers, body: request.body, redirect: 'manual' });
    // Keep the app's own redirects on this domain rather than sending visitors to the azurewebsites address. (Only
    // those that start with it: sign-in redirects to Google carry it inside, and Google must see it unchanged.)
    const location = response.headers.get('Location');
    if (location?.startsWith(`https://${ORIGIN}/`)) {
      const moved = new Response(response.body, response);
      moved.headers.set('Location', `https://${publicHost}/${location.slice(ORIGIN.length + 9)}`);
      return moved;
    }
    return response;
  },
};
