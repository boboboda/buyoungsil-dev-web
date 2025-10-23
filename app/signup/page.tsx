import SignUpComponent from "@/components/authComponents/signup";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  return (
    <div className="w-full h-full">
      <SignUpComponent />
    </div>
  );
}
