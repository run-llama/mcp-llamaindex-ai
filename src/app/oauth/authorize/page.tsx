import { auth } from '@/app/auth';
import { prisma } from '@/app/prisma';
import { redirect } from 'next/navigation';
import { randomBytes } from 'crypto';
import { headers } from 'next/headers';

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await auth();

  const params = await searchParams;

  const clientId = params.client_id as string;
  const redirectUri = params.redirect_uri as string;
  const responseType = params.response_type as string;
  const state = params.state as string;
  const code_challenge = params.code_challenge as string | undefined;
  const code_challenge_method = params.code_challenge_method as string | undefined;

  if (!session || !session.user || !session.user.id) {
    const headersList = await headers();
    const host = headersList.get('host');
    const prot = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const baseUrl = `${prot}://${host}`;

    const loginUrl = new URL('/api/auth/signin', baseUrl);
    const callbackUrl = new URL('/oauth/authorize', baseUrl);

    // Add all current search params to the callback URL
    Object.entries(params).forEach(([key, value]) => {
      if (typeof value === 'string') {
        callbackUrl.searchParams.set(key, value);
      }
    });

    loginUrl.searchParams.set('callbackUrl', callbackUrl.toString());
    return redirect(loginUrl.toString());
  }

  if (!clientId || !redirectUri || responseType !== 'code') {
    return (
      <main className="flex items-center justify-center h-screen">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p>Invalid authorization request.</p>
          <p className="text-xs text-gray-500 mt-4">
            Missing client_id, redirect_uri, or response_type is not 'code'.
          </p>
        </div>
      </main>
    );
  }

  const client = await prisma.client.findUnique({
    where: { clientId },
  });

  if (!client || !client.redirectUris.includes(redirectUri)) {
    return (
      <main className="flex items-center justify-center h-screen">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p>Invalid client or redirect URI.</p>
        </div>
      </main>
    );
  }

  async function handleConsent(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) {
      // This should not be reachable if the user sees the consent screen
      throw new Error('No session found during consent handling.');
    }

    if (!client) throw new Error('Client not found during consent handling.');

    const consent = formData.get('consent');

    const redirectUrl = new URL(redirectUri);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    if (consent === 'deny') {
      redirectUrl.searchParams.set('error', 'access_denied');
      return redirect(redirectUrl.toString());
    }

    const authorizationCode = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.authCode.create({
      data: {
        code: authorizationCode,
        expiresAt,
        clientId: client.id,
        userId: session.user.id,
        redirectUri: redirectUri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      },
    });

    redirectUrl.searchParams.set('code', authorizationCode);
    redirect(redirectUrl.toString());
  }

  return (
    <main className="authorize-main">
      <div className="container authorize-container">
        <h1 className="authorize-title">Authorize Application</h1>
        <div className="authorize-description">
          <p>
            The application{' '}
            <strong>{client.name}</strong> is requesting access to your account.
          </p>
          <p className="authorize-subtext">
            Do you want to grant access?
          </p>
        </div>
        <form action={handleConsent} className="authorize-form">
          <div className="authorize-actions">
            <button
              type="submit"
              name="consent"
              value="allow"
              className="button button-primary"
            >
              Allow
            </button>
            <button
              type="submit"
              name="consent"
              value="deny"
              className="button button-secondary"
            >
              Deny
            </button>
          </div>
        </form>
      </div>
    </main>
  );
} 
