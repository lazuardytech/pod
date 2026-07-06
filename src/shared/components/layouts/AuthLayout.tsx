"use client";
import PropTypes from "prop-types";

export default function AuthLayout({ children }: { children?: any; [key: string]: any }) {
  return (
    <div className="min-h-screen flex flex-col relative bg-pitch-black overflow-x-hidden">
      {/* Subtle background glow */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-porcelain/3 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[400px] bg-aether-blue/4 rounded-full blur-[100px] pointer-events-none z-0 translate-y-1/3 translate-x-1/3" />

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 z-10 w-full h-full">
        {children}
      </main>
    </div>
  );
}

AuthLayout.propTypes = {
  children: PropTypes.node.isRequired,
};
