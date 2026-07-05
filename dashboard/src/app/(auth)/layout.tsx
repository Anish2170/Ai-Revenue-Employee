export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-8"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        {children}
      </div>
    </div>
  );
}
