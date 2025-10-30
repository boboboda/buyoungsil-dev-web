export default function CenteredLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-7xl">
        {children}
      </div>
    </div>
  );
}