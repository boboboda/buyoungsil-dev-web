import { Card, CardBody } from "@heroui/react";
import { ReactNode } from "react";

interface GradientCardProps {
  children: ReactNode;
  gradient?: string;
  className?: string;
  isPressable?: boolean;
  isHoverable?: boolean;
  shadow?: "none" | "sm" | "md" | "lg";
}

export function GradientCard({ 
  children, 
  gradient = "from-blue-500 to-purple-500",
  className = "",
  isPressable = false,
  isHoverable = true,
  shadow = "lg"
}: GradientCardProps) {
  return (
    <Card 
      isPressable={isPressable}
      isHoverable={isHoverable}
      shadow={shadow}
      className={`group relative ${className}`}
    >
      {/* Hover gradient border effect */}
      {isHoverable && (
        <div className={`absolute inset-0 rounded-xl bg-gradient-to-r ${gradient} opacity-0 group-hover:opacity-20 transition-opacity`} />
      )}
      
      <CardBody className="relative">
        {children}
      </CardBody>
    </Card>
  );
}