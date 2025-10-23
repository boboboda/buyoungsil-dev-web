export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full">
      <div className="max-w-[1400px] w-full mx-auto mt-3 justify-center items-center">
        {children}
      </div>
    </div>
  );
}
