"use client";

import { Card, CardHeader, CardFooter, Image, Button } from "@heroui/react";
// import { useUserStore } from "@/components/providers/user-store-provider"
import { useRouter } from "next/navigation";

export default function NoteContentCard() {
  const router = useRouter();

  return (
    <div className="max-w-[1000px] px-4 mt-[20px]">
      <div className="w-full gap-3 grid grid-cols-12 grid-rows-2 ">
        <Card
          isPressable
        className="col-span-12 h-[250px] pt-2 flex justify-start bg-slate-800 gap-4 hover:cursor-pointer hover:bg-gray-600"
        onClick={()=>{
          // console.log('노트 누름')
          router.push("/note/basics")

          // window.location.href = "/note/react"
        }}
        >
          <div className="flex w-full h-[50px] items-center justify-center">
            <h4 className=" text-white font-medium md:text-[24px] text-[20px]">
              개발자 사이드 지식
            </h4>
          </div>

          <div className="flex flex-row w-full justify-center">
            <div className="w-[50%] flex justify-end me-10">
              <Image
                removeWrapper
                alt="Card background"
                className="object-cover md:w-[200px] w-[150px]"
                src="/cardImg_1.png"
              />
            </div>
            <div className="flex flex-col w-[50%] h-full mt-[5px] justify-start gap-4">
              <h4 className="text-white font-medium md:text-[17px] text-[14px] ms-2 text-left">
                1. 개발자는 무엇인가?
              </h4>
              <h4 className="text-white font-medium md:text-[17px] text-[14px] ms-2 text-left">
                2. 네트워크
              </h4>
              <h4 className="text-white font-medium md:text-[17px] text-[14px] ms-2 text-left">
                3. 그래픽 디자인
              </h4>
            </div>
          </div>
        </Card>
        <Card
          isPressable
        className="custom-shadow col-span-12 sm:col-span-6 h-[250px] flex justify-start bg-slate-800 gap-4 hover:cursor-pointer hover:bg-gray-600"
        onClick={()=>{
          // console.log('노트 누름')
          router.push("/note/android")

          // window.location.href = "/note/react"
        }}
        >
          <div className="flex w-full h-[50px] items-center justify-center">
            <h4 className="text-white font-medium md:text-[24px] text-[20px]">
              Android Jetpack Compose
            </h4>
          </div>
          <div className="flex flex-row">
            <div className="flex w-[40%] items-center justify-center">
              <Image
                removeWrapper
                alt="Card background"
                className="w-[90%] object-cover"
                src="/composeLogo.png"
              />
            </div>
            <div className="flex flex-col w-[60%] h-full mt-[5px] justify-start gap-2">
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                1. 컴포즈 ui 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                2. 파이어베이스 연동, 로컬 Room DB 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                3. 다양한 아키텍처 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                4. 딥링크 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                5. 배포 및 버전관리
              </h4>
            </div>
          </div>
        </Card>
        <Card
          isPressable
        className="custom-shadow col-span-12 sm:col-span-6 h-[250px] flex justify-start bg-slate-800 gap-4 hover:cursor-pointer hover:bg-gray-600"
        onClick={()=>{
          // console.log('노트 누름')
          router.push("/note/nextjs")

          // window.location.href = "/note/react"
        }}>
          <div className="flex w-full h-[50px] items-center justify-center">
            <h4 className="text-white font-medium md:text-[24px] text-[20px]">Web Develop</h4>
          </div>
          <div className="flex flex-row">
            <div className="flex w-[60%] items-center justify-center">
              <Image
                removeWrapper
                alt="Card background"
                className="w-[90%] object-cover"
                src="/cardImg_2.png"
              />
            </div>
            <div className="flex flex-col w-[40%] h-full mt-[5px] justify-start gap-2">
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                1. 리액트 사용법
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                2. nextjs SSR, CSR
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                3. CSS 익히기
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                4. HTML 구조 익히기
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                5. 풀스택 개발
              </h4>
            </div>
          </div>
        </Card>
        <Card
          isPressable
        className="custom-shadow w-full h-[250px] bg-slate-800 col-span-12 hover:cursor-pointer hover:bg-gray-600 sm:col-span-4"
        onClick={()=>{
          // console.log('노트 누름')
          router.push("/note/nestjs")

          // window.location.href = "/note/react"
        }}>
        
          <div className="flex w-full h-[50px] items-center justify-center">
            <h4 className="text-white font-medium md:text-[24px] text-[20px]">NestJS</h4>
          </div>
          <div className="flex flex-row">
            <div className="flex md:w-[60%] w-[55%] items-center justify-center">
              <Image
                removeWrapper
                alt="Card background"
                className="w-[90%] object-cover"
                src="/card_3.svg"
              />
            </div>
            <div className="flex flex-col md:w-[40%] w-[45%] h-full mt-[5px] justify-start gap-2">
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                1. 백앤드 개발
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                2. CRUD 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                3. 스케줄러 구현
              </h4>
            </div>
          </div>
        </Card>
        
        {/* 🔥 SwiftUI / iOS 개발 카드 */}
        <Card
          isPressable
          className="custom-shadow w-full h-[250px] bg-slate-800 col-span-12 hover:cursor-pointer hover:bg-gray-600 sm:col-span-8"
          onClick={() => {
            router.push("/note/swiftui");
          }}
        >
          <div className="flex w-full h-[50px] items-center justify-center">
            <h4 className="text-white font-medium md:text-[24px] text-[20px]">
              SwiftUI / iOS 개발
            </h4>
          </div>
          <div className="flex flex-row h-full">
            <div className="flex md:w-[45%] w-[40%] items-center justify-center">
              <Image
                removeWrapper
                alt="SwiftUI Logo"
                className="md:w-[70%] w-[80%] object-contain"
                src="/swiftui-logo.png"
              />
            </div>
            <div className="flex flex-col md:w-[55%] w-[60%] h-full mt-[5px] justify-start gap-2 pe-2">
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                1. SwiftUI 기초 및 UI 구현
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                2. CoreData, UserDefaults 데이터 관리
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                3. MVVM 아키텍처 패턴
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                4. Firebase 연동 및 푸시 알림
              </h4>
              <h4 className="text-white font-medium md:text-[14px] text-[12px] ms-2 text-left">
                5. 앱스토어 배포 및 심사
              </h4>
            </div>
          </div>
        </Card>
      </div>
      </div>
  );
}