"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";

export default function LoginClient() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [isDefaultPassword, setIsDefaultPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      try {
        const res = await fetch(`${baseUrl}/api/settings`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false) {
            router.push("/endpoint");
            router.refresh();
            return;
          }
          setHasPassword(!!data.hasPassword);
          setIsDefaultPassword(!!data.isDefaultPassword);
        } else {
          setHasPassword(true);
        }
      } catch {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/endpoint");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        setLoading(false);
      }
    } catch {
      setError("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pitch-black">
        <LucideIcon name="progress_activity" className="animate-spin text-storm-cloud text-[28px]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-pitch-black p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-porcelain/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center size-10 mb-4">
            <img src="/logo.svg" alt="Pod" className="size-10 dark:invert" />
          </div>
          <h1 className="font-brand text-[20px] font-[510] text-porcelain tracking-[-0.22px]">Pod</h1>
          <p className="text-[13px] text-storm-cloud mt-1 tracking-[-0.12px]">Enter your password to continue</p>
        </div>

        {/* Card */}
        <Card padding="sm" elev>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <Input
              type="password"
              label="Password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
              required
              autoFocus
              icon="lock"
              inputClassName="pl-10"
            />

            <Button type="submit" variant="primary" fullWidth loading={loading} disabled={loading} size="md">
              {loading ? "Signing in..." : "Sign in"}
            </Button>

            {isDefaultPassword && (
              <p className="text-[11px] text-center text-fog-grey mt-1">
                Default password is{" "}
                <code className="bg-gunmetal px-1.5 py-0.5 rounded-[4px] text-storm-cloud font-mono">123456</code>
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
