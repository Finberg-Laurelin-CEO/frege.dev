type SearchParams = Promise<{ error?: string; message?: string }>;

export default async function AuthErrorPage({ searchParams }: { searchParams: SearchParams }) {
  const { error, message } = await searchParams;

  return (
    <main style={{ maxWidth: 560, margin: "10vh auto", padding: "0 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Sign-in failed</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        Auth0 could not complete the sign-in. Details below.
      </p>
      <pre
        style={{
          background: "#f5f5f5",
          padding: 16,
          borderRadius: 8,
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        error: {error ?? "unknown"}
        {message ? `\nmessage: ${message}` : ""}
      </pre>
      <p style={{ marginTop: 20 }}>
        <a href="/auth/login" style={{ color: "#0b69ff" }}>
          Try signing in again
        </a>
      </p>
    </main>
  );
}
