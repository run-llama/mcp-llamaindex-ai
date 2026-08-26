// Domain-ownership challenge for the OpenAI Apps directory submission. OpenAI
// GETs this on submission and expects the token back as raw text, nothing else.
// The token is public by design; it only proves control of the origin serving it.
const CHALLENGE_TOKEN = 'w7YODTyahyN4U_utvmJZ-GgJYn7pxyFNUQG19DS77Lc';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(CHALLENGE_TOKEN, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
