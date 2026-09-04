"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import { Button, Card, Input } from "@/shared/components";

export default function LoginClient() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDefaultPassword, setIsDefaultPassword] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    fetch("/api/settings", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            requireLogin?: boolean;
            isDefaultPassword?: boolean;
          } | null,
        ) => {
          clearTimeout(timeoutId);
          if (cancelled || !data) return;
          if (data.requireLogin === false) {
            router.push("/endpoint");
            router.refresh();
            return;
          }
          setIsDefaultPassword(!!data.isDefaultPassword);
        },
      )
      .catch(() => {
        clearTimeout(timeoutId);
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [router]);

  const handleLogin = async (e: FormEvent) => {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-pitch-black p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-porcelain/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center size-10 mb-4">
            <Image
              src="/logo.svg"
              alt="Pod"
              width={40}
              height={40}
              className="size-10 dark:invert"
              unoptimized
            />
          </div>
          <h1 className="font-brand text-[20px] font-[510] text-porcelain tracking-[-0.22px]">
            Pod
          </h1>
          <p className="text-[13px] text-storm-cloud mt-1 tracking-[-0.12px]">
            Enter your password to continue
          </p>
        </div>

        {/* Card */}
        <Card padding="sm" elev>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <Input
              type="password"
              label="Password"
              placeholder="Enter password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.currentTarget.value)}
              error={error}
              required
              autoFocus
              icon="lock"
              inputClassName="pl-10"
            />

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={loading}
              disabled={loading}
              size="md"
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>

            {isDefaultPassword && (
              <p className="text-[11px] text-center text-fog-grey mt-1">
                Default password is{" "}
                <code className="bg-gunmetal px-1.5 py-0.5 rounded-[4px] text-storm-cloud font-mono">
                  123456
                </code>
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
