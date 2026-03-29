"use client";

import { useEffect, useState } from "react";

export type DeviceType = "mobile" | "tablet" | "laptop";

/**
 * Hook to detect device type based on screen width
 * Mobile: < 768px, Tablet: 768px - 1024px, Laptop: > 1024px
 */
export function useDeviceType(): DeviceType {
  const [deviceType, setDeviceType] = useState<DeviceType>("laptop");

  useEffect(() => {
    const checkDeviceType = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setDeviceType("mobile");
      } else if (width < 1024) {
        setDeviceType("tablet");
      } else {
        setDeviceType("laptop");
      }
    };

    // Check on mount
    checkDeviceType();

    // Listen for resize events
    const resizeListener = () => checkDeviceType();
    window.addEventListener("resize", resizeListener);
    return () => window.removeEventListener("resize", resizeListener);
  }, []);

  return deviceType;
}

/**
 * Hook to check if device should use modal-based UI
 * Returns true for laptop and tablet, false for mobile
 */
export function useShouldUseModal(): boolean {
  const deviceType = useDeviceType();
  return deviceType !== "mobile";
}
