export default function WriteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col w-[80%] mx-auto">{children}</div>;
}
