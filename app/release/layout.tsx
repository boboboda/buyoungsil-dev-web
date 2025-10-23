export default function ReleaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="max-w-[1400px] w-full mx-auto mt-3">{children}</div>;
}
