import { Card, CardBody } from "@heroui/react";
import { ReactNode } from "react";

interface GradientCardProps {
  children: ReactNode;
  gradient?: string;
  className?: string;
  isPressable?: boolean;
  isHoverable?: boolean;
  shadow?: "none" | "sm" | "md" | "lg";
  fullHeight?: boolean;  // ⭐ 새로 추가!
}

export function GradientCard({ 
  children, 
  gradient = "from-blue-500 to-purple-500",
  className = "",
  isPressable = false,
  isHoverable = true,
  shadow = "lg",
  fullHeight = false  // ⭐ 기본값은 false
}: GradientCardProps) {
  return (
    <Card 
      isPressable={isPressable}
      isHoverable={isHoverable}
      shadow={shadow}
      className={`group relative ${fullHeight ? 'h-full' : ''} ${className}`}  // ⭐ 조건부 적용
    >
      {/* Hover gradient border effect */}
      {isHoverable && (
        <div className={`absolute inset-0 rounded-xl bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-20 transition-opacity`} />
      )}
      
      <CardBody className={`relative ${fullHeight ? 'h-full' : ''}`}>  {/* ⭐ 조건부 적용 */}
        {children}
      </CardBody>
    </Card>
  );
}