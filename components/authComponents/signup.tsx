"use client";

import { signIn } from "next-auth/react"; // 🔥 NextAuth 직접 사용
import { Button, Input } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";

export default function SignUpComponent() {
  const router = useRouter();

  // 🔥 로딩 상태만 유지
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);

  const [isInvalidName, setIsInvalidName] = useState(false);
  const [isInvalidEmail, setIsInvalidEmail] = useState(false);
  const [isInvalidPassword, setIsInvalidPassword] = useState(false);
  const [isInvalidConfirmPassword, setIsInvalidConfirmPassword] =
    useState(false);

  const [isVisible, setIsVisible] = useState(false);
  const [confirmPasswordIsVisible, setConfirmPasswordIsVisible] =
    useState(false);

  const [nameFoucus, setNameFocus] = useState(false);
  const [emailFoucus, setEmailFocus] = useState(false);
  const [passwordFoucus, setPasswordFocus] = useState(false);
  const [confirmPasswordFoucus, setConfirmPasswordFocus] = useState(false);

  const validateName = (name: string) => name.match(/^[가-힣a-zA-Z0-9]+$/);
  const validateEmail = (email: string) =>
    email.match(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+.[A-Z]{2,4}$/i);
  const validatePassword = (password: string) => password.length >= 8;
  const validateConfirmPassword = (confirmPassword: string) =>
    confirmPassword === password;

  useEffect(() => {
    if (nameFoucus) {
      setIsInvalidName(name === "" || !validateName(name));
    } else {
      setIsInvalidName(false);
    }
  }, [name, nameFoucus]);

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

  useEffect(() => {
    if (confirmPasswordFoucus) {
      setIsInvalidConfirmPassword(
        confirmPassword === "" || !validateConfirmPassword(confirmPassword),
      );
    } else {
      setIsInvalidConfirmPassword(false);
    }
  }, [confirmPassword, password, confirmPasswordFoucus]);

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

  const confirmToggleVisibility = () => {
    if (confirmPasswordInputRef.current) {
      const cursorPosition = confirmPasswordInputRef.current.selectionStart;

      setConfirmPasswordIsVisible(!confirmPasswordIsVisible);

      setTimeout(() => {
        confirmPasswordInputRef.current?.setSelectionRange(
          cursorPosition,
          cursorPosition,
        );
      }, 0);
    }
  };

  const allConfirm =
    !isInvalidName &&
    !isInvalidEmail &&
    !isInvalidPassword &&
    !isInvalidConfirmPassword &&
    name !== "" &&
    email !== "" &&
    password !== "" &&
    confirmPassword !== "";

  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyFailedEvent = (msg: string) => toast.error(msg);

  // 🔥 NextAuth signIn 직접 사용
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // NextAuth credentials provider로 회원가입
      const result = await signIn("credentials", {
        name,
        email,
        password,
        action: "register", // 회원가입 액션
        redirect: false,
      });

      if (result?.error) {
        notifyFailedEvent("회원가입이 실패하였습니다. 다시 시도해주세요");
        console.error(result.error);
      } else {
        // 회원가입 성공
        notifySuccessEvent("회원가입이 완료되었습니다!");
        router.push("/");
      }
    } catch (error) {
      console.error("회원가입 오류:", error);
      notifyFailedEvent("회원가입 처리 중 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center w-full py-[20px]">
      <div className="custom-shadow flex flex-col items-center w-[350px] rounded-[20px] bg-white dark:bg-black py-[25px] gap-2">
        {/* 🔥 form onSubmit으로 변경 */}
        <form
          className="flex flex-col w-full mx-0 px-0 justify-center items-center gap-2"
          onSubmit={handleSignUp}
        >
          <Input
            className="max-w-xs h-[80px]"
            color={isInvalidName ? "danger" : "success"}
            errorMessage={isInvalidName ? "1자 이상 입력해주세요" : ""}
            isInvalid={isInvalidName}
            label="Name"
            name="name"
            placeholder="Enter your Name"
            type="text"
            value={name}
            variant="bordered"
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setNameFocus(true)}
          />

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

          <Input
            ref={confirmPasswordInputRef}
            className="max-w-xs h-[80px]"
            color={isInvalidConfirmPassword ? "danger" : "success"}
            endContent={
              <button
                className="focus:outline-none"
                type="button"
                onClick={confirmToggleVisibility}
                onMouseDown={(e) => e.preventDefault()}
              >
                <FontAwesomeIcon
                  className="text-md text-default-400 pointer-events-none"
                  icon={confirmPasswordIsVisible ? faEye : faEyeSlash}
                />
              </button>
            }
            errorMessage={
              isInvalidConfirmPassword ? "비밀번호가 일치하지 않습니다" : ""
            }
            isInvalid={isInvalidConfirmPassword}
            label="Confirm Password"
            placeholder="Confirm your password"
            type={confirmPasswordIsVisible ? "text" : "password"}
            value={confirmPassword}
            variant="bordered"
            onBlur={() => setConfirmPasswordIsVisible(false)}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onFocus={() => setConfirmPasswordFocus(true)}
          />

          <Button
            className="w-[90%] h-[50px]"
            color={allConfirm && !isSubmitting ? "primary" : "default"}
            disabled={!allConfirm || isSubmitting}
            type="submit"
          >
            <span className="text-white text-center text-[16px]">
              {isSubmitting ? "처리 중..." : "Sign up"}
            </span>
          </Button>
        </form>
      </div>
    </div>
  );
}
