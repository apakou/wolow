"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

/**
 * Listens for unhandled errors and unhandled promise rejections globally
 * and sends them to the error logging API.
 * Mount once at the top of the component tree.
 */
export default function GlobalErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportError({
        message: event.message || "Unhandled error",
        stack: event.error?.stack,
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      reportError({
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { type: "unhandledrejection" },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
