import NavbarController from "@/lib/wrappers/NavbarController";

export default function NoteItemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full">
      <NavbarController show={false} />
      {children}
    </div>
  );
}
