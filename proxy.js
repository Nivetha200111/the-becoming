import { NextResponse } from 'next/server.js';
import { requestAuthenticated, requestOrigin } from './lib/auth.mjs';

// Guard direct static URLs too, so /game/index.html cannot skip the passphrase.
export function proxy(request) {
  const response = requestAuthenticated(request)
    ? NextResponse.next()
    : NextResponse.redirect(new URL('/login', requestOrigin(request)));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/game/:path*'] };
