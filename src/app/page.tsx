import { auth, signIn, signOut } from "./auth";

export default async function Home() {
  const session = await auth();

  return (
    <div className="container">
      {session?.user ? (
        <div className="auth-container">
          <p>Welcome {session.user.name}!</p>
          <form action={async () => { 'use server'; await signOut(); }}>
            <button className="button button-signout">
              Sign Out
            </button>
          </form>
        </div>
      ) : (
        <form action={async () => { 'use server'; await signIn('google'); }}>
          <button className="button button-signin">
            Sign in with Google
          </button>
        </form>
      )}
    </div>
  );
}
