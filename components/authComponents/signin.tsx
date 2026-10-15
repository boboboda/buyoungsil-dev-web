"use client";

import { signIn } from "next-auth/react"; // 🔥 NextAuth 직접 사용
import { Button, Input } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub, faGoogle } from "@fortawesome/free-brands-svg-icons";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";

// 통제실 로그인 넘김(/api/admin/handoff)으로 돌아오는 callbackUrl 만 따른다(같은 도메인의 이 경로 하나만 허용)
function handoffCallback(): string | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("callbackUrl");

  return raw && /^\/api\/admin\/handoff\?to=%2F[A-Za-z0-9%_\-.~]*$/.test(raw) ? raw : null;
}

export default function SignInComponent() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const [isInvalidEmail, setIsInvalidEmail] = useState(false);
  const [isInvalidPassword, setIsInvalidPassword] = useState(false);

  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // 🔥 로딩 상태 추가

  const [emailFoucus, setEmailFocus] = useState(false);
  const [passwordFoucus, setPasswordFocus] = useState(false);

  const validateEmail = (email: string) =>
    email.match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+.[A-Z]{2,4}$/i);
  const validatePassword = (password: string) => password.length >= 8;

  useEffect(() => {
    if (emailFoucus) {
      setIsInvalidEmail(email === "" || !validateEmail(email));
    } else {
      setIsInvalidEmail(false);
    }
  }, [email, emailFoucus]);

  useEffect(() => {
    if (passwordFoucus) {
      setIsInvalidPassword(password === "" || !validatePassword(password));
    } else {
      setIsInvalidPassword(false);
    }
  }, [password, passwordFoucus]);

  const notifyFailedEvent = (msg: string) => toast.error(msg);

  // 🔥 NextAuth signIn 직접 사용
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        action: "login",
        redirect: false, // 자동 리다이렉트 방지
      });

      if (result?.error) {
        notifyFailedEvent("로그인이 실패하였습니다. 다시 시도해주세요");
        console.error(result.error);
      } else {
        // 로그인 성공
        toast.success("로그인 성공!");
        const back = handoffCallback();

        if (back) window.location.assign(back);
        else router.push("/");
      }
    } catch (error) {
      notifyFailedEvent("로그인 중 오류가 발생했습니다.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // 🔥 OAuth 로그인 - NextAuth 직접 사용
  const handleGitHubSignIn = () => {
    signIn("github", {
      callbackUrl: handoffCallback() ?? "/?login=success&provider=github",
    });
  };

  const handleGoogleSignIn = () => {
    signIn("google", {
      callbackUrl: handoffCallback() ?? "/?login=success&provider=google",
    });
  };

  const toggleVisibility = () => {
    if (passwordInputRef.current) {
      const cursorPosition = passwordInputRef.current.selectionStart;

      setIsVisible(!isVisible);

      setTimeout(() => {
        passwordInputRef.current?.setSelectionRange(
          cursorPosition,
          cursorPosition,
        );
      }, 0);
    }
  };

  const allConfirm =
    !isInvalidEmail && !isInvalidPassword && email !== "" && password !== "";

  return (
    <div className="flex justify-center w-full">
      <div className="flex flex-col custom-shadow items-center w-[350px] rounded-[20px] dark:bg-black py-[20px] gap-2">
        {/* 🔥 GitHub 로그인 - 간단해짐 */}
        <Button
          className="w-[90%] h-[50px] mb-[10px]"
          onClick={handleGitHubSignIn}
        >
          <FontAwesomeIcon className="size-[24px]" icon={faGithub} />
          Sign in with GitHub
        </Button>

        {/* 🔥 Google 로그인 - 간단해짐 */}
        <Button
          className="w-[90%] h-[50px] bg-blue-600"
          onClick={handleGoogleSignIn}
        >
          <FontAwesomeIcon className="size-[24px]" icon={faGoogle} />
          Sign in with Google
        </Button>

        <div className="w-full flex justify-center">
          <h1>or</h1>
        </div>

        {/* 🔥 Credentials 로그인 - NextAuth 사용 */}
        <form
          className="flex flex-col w-full mx-0 px-0 justify-center items-center gap-2"
          onSubmit={handleSignIn}
        >
          <Input
            className="max-w-xs h-[80px]"
            color={isInvalidEmail ? "danger" : "success"}
            errorMessage={
              isInvalidEmail ? "이메일 형식에 맞게 작성해주세요" : ""
            }
            isInvalid={isInvalidEmail}
            label="Email"
            name="email"
            placeholder="Enter your Email"
            type="email"
            value={email}
            variant="bordered"
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setEmailFocus(true)}
          />

          <Input
            ref={passwordInputRef}
            className="max-w-xs h-[80px]"
            color={isInvalidPassword ? "danger" : "success"}
            endContent={
              <button
                className="focus:outline-none"
                type="button"
                onClick={toggleVisibility}
                onMouseDown={(e) => e.preventDefault()}
              >
                <FontAwesomeIcon
                  className="text-md text-default-400 pointer-events-none"
                  icon={isVisible ? faEye : faEyeSlash}
                />
              </button>
            }
            errorMessage={isInvalidPassword ? "8자 이상 입력해주세요" : ""}
            isInvalid={isInvalidPassword}
            label="Password"
            name="password"
            placeholder="Enter your password"
            type={isVisible ? "text" : "password"}
            value={password}
            variant="bordered"
            onBlur={() => setIsVisible(false)}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setPasswordFocus(true)}
          />

          <Button
            className="w-[90%] h-[50px]"
            color={allConfirm ? "primary" : "default"}
            disabled={!allConfirm || isLoading}
            type="submit"
          >
            <span className="text-white text-center text-[16px]">
              {isLoading ? "로그인 중..." : "Sign In"}
            </span>
          </Button>
        </form>
      </div>
    </div>
  );
}
