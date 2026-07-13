import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth is validated by the dashboard client against the backend API.
 *
 * The backend session cookie is scoped to the Render API domain, so Vercel
 * middleware cannot reliably read it. Keeping this middleware as pass-through
 * prevents a login bounce while preserving the existing route structure.
 */
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
