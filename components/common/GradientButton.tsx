"use client";

import { Button, ButtonProps } from "@heroui/react";
import { ReactNode } from "react";

interface GradientButtonProps extends Omit<ButtonProps, 'children'> {
  children: ReactNode;
  gradient?: string;
}

export function GradientButton({ 
  children,
  gradient = "from-blue-600 to-purple-600",
  className = "",
  ...props
}: GradientButtonProps) {
  return (
    <Button
      {...props}
      className={`bg-gradient-to-r ${gradient} text-white font-semibold shadow-lg hover:shadow-xl transition-all ${className}`}
    >
      {children}
    </Button>
  );
}