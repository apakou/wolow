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

      // Ignore errors from browser extensions — not actionable
      if (
        err instanceof Error &&
        err.stack?.includes("chrome-extension://")
      ) return;
      if (
        typeof err === "object" && err !== null &&
        "stack" in err && typeof err.stack === "string" &&
        err.stack.includes("chrome-extension://")
      ) return;

      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === "object" && err !== null && "message" in err) {
        message = String((err as { message: unknown }).message);
      } else if (typeof err === "string") {
        message = err;
      } else {
        try { message = JSON.stringify(err); } catch { message = "Unhandled promise rejection"; }
      }

      reportError({
        message,
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
