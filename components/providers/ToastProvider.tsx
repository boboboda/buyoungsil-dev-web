// src/components/providers/ToastProvider.tsx

"use client";

import dynamic from "next/dynamic";
import "react-toastify/dist/ReactToastify.css";

const ToastContainer = dynamic(
  () => import("react-toastify").then((mod) => mod.ToastContainer),
  {
    ssr: false,
  },
);

export function ToastProvider() {
  return (
    <ToastContainer
      closeOnClick
      draggable
      pauseOnFocusLoss
      pauseOnHover
      autoClose={1800}
      className="foo"
      hideProgressBar={false}
      newestOnTop={false}
      position="top-right"
      rtl={false}
      style={{ width: "450px" }}
      theme="dark"
    />
  );
}
