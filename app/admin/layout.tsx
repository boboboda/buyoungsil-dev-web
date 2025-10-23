export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="w-full max-w-[1400px]">{children}</div>;
}
