"use client";

import Image from "next/image";

import { Link } from "@/lib/i18n/navigation";

export interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Logo({ className = "", showText = true, size = "md" }: LogoProps) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  const sizePixels = {
    sm: 24,
    md: 32,
    lg: 48,
  };

  const textSizeClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  return (
    <Link
      href="/"
      className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${className}`}
    >
      {/* Logo Icon */}
      <Image
        src="/logo.png"
        alt="RiluTrip"
        width={sizePixels[size]}
        height={sizePixels[size]}
        className={`${sizeClasses[size]} object-contain`}
      />

      {/* Logo Text */}
      {showText && (
        <span className={`${textSizeClasses[size]} font-bold text-foreground`}>RiluTrip</span>
      )}
    </Link>
  );
}
