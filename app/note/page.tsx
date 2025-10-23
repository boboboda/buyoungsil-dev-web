export const dynamic = "force-dynamic";

import NoteContentCard from "@/components/developmentNote/userNote/noteContentCard";

export default function Note() {
  return (
    <div className="mx-auto flex mt-7 md:flex-col flex-row items-center justify-center">
      <NoteContentCard />
    </div>
  );
}
