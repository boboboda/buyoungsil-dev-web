"use client"

import React, { useEffect } from "react";
import {
    Image, Card, CardFooter, CardBody, Tooltip, Chip, Button, Link,
    Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, listboxSection,
} from "@heroui/react";


import { title, subtitle, ButtnCustom } from "../primitives";
import { TagCustom } from "../primitives";
import { Divider } from "@heroui/react";
import { useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation"
import { App } from "@/types";

export default function ReleaseItem({ app }: { app: App }) {
    const appTitle = app.title
    const appLink = app.appLink
    const description = app.description
    const imgSrc = app.coverImage
    const appTags = app.tags

    const linesDescription = description.split("\n");
    const router = useRouter()
    const pathname = usePathname();

    let [noticeHref, setNoticeHref] = useState("")
    let [postHref, setPostHref] = useState("")



    useEffect(() => {
        setPostHref(app.databaseId ?? "")
        setNoticeHref(app.databaseId ?? "")
    }, [])

    return (
        <div className="w-full"> {/* 컨테이너 크기 제한 제거 */}
            <Card className="flex flex-col bg-white dark:bg-slate-500 rounded-xl transition duration-300 transform border border-gray-300
                hover:scale-105 hover:shadow-lg dark:border-gray-200/50 dark:hover:shadow-gray-400/40 
                w-full h-full mx-2 my-3 md:mx-0 md:my-0"> {/* 모바일에서만 마진 추가 */}

                <CardBody className="overflow-visible space-y-4 p-4 md:p-6 flex flex-col"> {/* 반응형 패딩 */}

                    {/* 이미지 영역 - 반응형 처리 */}
                    <div className="w-full">
                        <Image
                            shadow="sm"
                            className="w-full h-48 md:h-64 object-cover rounded-lg"
                            src={`${imgSrc}`}
                            alt="App Image"
                            removeWrapper
                        />
                    </div>

                    {/* 콘텐츠 영역 */}
                    <div className="flex flex-col space-y-3 md:space-y-4 flex-grow"> {/* flex-grow 추가 */}

                        {/* 타이틀 */}
                        <h3 className="text-lg md:text-xl font-bold text-center text-gray-900 dark:text-white">
                            {appTitle}
                        </h3>

                        {/* 설명 */}
                        <div className="text-sm md:text-base text-gray-700 dark:text-gray-300 space-y-1">
                            {linesDescription.map((item, index) => (
                                <p key={index} className="leading-relaxed">
                                    {item}
                                </p>
                            ))}
                        </div>

                        {/* 태그들 */}
                        <div className="flex flex-wrap gap-2">
                            {appTags.map((aTag: any) => (
                                <Chip
                                    key={aTag.id}
                                    color={aTag.color}
                                    size="sm"
                                    className="text-xs"
                                >
                                    {aTag.name}
                                </Chip>
                            ))}
                        </div>
                    </div>

                    <Divider className="my-3" />

                    {/* 버튼 영역 - 모바일 반응형 */}
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-auto"> {/* 모바일: 세로, 데스크톱: 가로 */}

                        <Button
                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                            onPress={() => window.open(appLink, '_blank')}
                        >
                            앱 바로가기
                        </Button>

                        <Dropdown>
                            <DropdownTrigger>
                                <Button className="flex-1 sm:flex-initial bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg transition-colors">
                                    메뉴
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu>
                                <DropdownItem
                                    key={`notice-${noticeHref}`}  // 고유하게 수정
                                    onPress={() => router.push(`release/notice/${noticeHref}`)}
                                >
                                    공지사항
                                </DropdownItem>

                                <DropdownItem
                                    key={`post-${postHref}`}     // 고유하게 수정
                                    onPress={() => router.push(`release/post/${postHref}`)}
                                >
                                    문의게시판
                                </DropdownItem>

                                <DropdownItem key="privacy-policy">
                                    개인정보처리방침
                                </DropdownItem>
                            </DropdownMenu>
                        </Dropdown>
                    </div>

                </CardBody>
            </Card>
        </div>
    )
}

// 그리드 레이아웃을 위한 부모 컴포넌트 예시
/*
PC: 3개씩, 좁은 간격
모바일: 1개씩, 위아래 간격

<div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-3 p-4 md:p-6">
    {apps.map((app) => (
        <ReleaseItem key={app.id} app={app} />
    ))}
</div>
*/