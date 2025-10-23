import ReleaseAddComponent from "@/components/appRegisterComponent/ReleaseItemAddComponent";

export const dynamic = "force-dynamic";

export default async function AppRegisterPage() {
  return (
    <div className=" gap-0 justify-center items-center px-5">
      {<ReleaseAddComponent />}
    </div>
  );
}
