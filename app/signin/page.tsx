import SignInComponent from "@/components/authComponents/signin";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  return (
    <div className="w-full h-full">
      <SignInComponent />
    </div>
  );
}
