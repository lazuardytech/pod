"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
import { Button, Card, Input, Select, Toggle } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import { AI_PROVIDERS, AUTH_METHODS } from "@/shared/constants/config";

const providerOptions = Object.values(AI_PROVIDERS).map((p) => ({
  value: p.id,
  label: p.name,
}));

const authMethodOptions = Object.values(AUTH_METHODS).map((m) => ({
  value: m.id,
  label: m.name,
}));

const CardSection = (
  Card as typeof Card & { Section: ComponentType<{ children?: ReactNode; className?: string }> }
).Section;

type FormData = {
  provider: string;
  authMethod: string;
  apiKey: string;
  displayName: string;
  isActive: boolean;
};

type FormField = keyof FormData;

export default function NewProviderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    provider: "",
    authMethod: "apikey",
    apiKey: "",
    displayName: "",
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const handleChange = <K extends FormField>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.provider) newErrors.provider = "Please select a provider";
    if (formData.authMethod === "apikey" && !formData.apiKey) {
      newErrors.apiKey = "API Key is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        router.push("/providers");
      } else {
        const data = (await response.json()) as { error?: string };
        setErrors({ submit: data.error || "Failed to create provider" });
      }
    } catch (_error) {
      setErrors({ submit: "An error occurred. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const selectedProvider = AI_PROVIDERS[formData.provider];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Add New Provider</h1>
        <p className="text-text-muted mt-2">
          Configure a new AI provider to use with your applications.
        </p>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Provider Selection */}
          <Select
            label="Provider"
            options={providerOptions}
            value={formData.provider}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              handleChange("provider", e.target.value)
            }
            placeholder="Select a provider"
            error={errors.provider}
            required
          />

          {/* Provider Info */}
          {selectedProvider && (
            <CardSection className="flex items-center gap-3">
              <div className="size-10 rounded-lg flex items-center justify-center bg-bg border border-border">
                <LucideIcon
                  name={selectedProvider.icon}
                  className="text-xl"
                  style={{ color: selectedProvider.color }}
                />
              </div>
              <div>
                <p className="font-medium">{selectedProvider.name}</p>
                <p className="text-sm text-text-muted">Selected provider</p>
              </div>
            </CardSection>
          )}

          {/* Auth Method */}
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">
              Authentication Method <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              {authMethodOptions.map((method) => (
                <Button
                  key={method.value}
                  type="button"
                  variant={formData.authMethod === method.value ? "primary" : "outline"}
                  onClick={() => handleChange("authMethod", method.value)}
                  icon={method.value === "apikey" ? "key" : "lock"}
                  className={`flex-1 p-4 h-auto ${
                    formData.authMethod === method.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium">{method.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* API Key Input */}
          {formData.authMethod === "apikey" && (
            <Input
              label="API Key"
              type="password"
              placeholder="Enter your API key"
              value={formData.apiKey}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleChange("apiKey", e.target.value)
              }
              error={errors.apiKey}
              hint="Your API key will be encrypted and stored securely."
              required
            />
          )}

          {/* OAuth2 Button */}
          {formData.authMethod === "oauth" && (
            <CardSection>
              <p className="text-sm text-text-muted mb-4">
                Connect your account using OAuth2 authentication.
              </p>
              <Button type="button" variant="secondary" icon="link">
                Connect with OAuth2
              </Button>
            </CardSection>
          )}

          {/* Display Name */}
          <Input
            label="Display Name"
            placeholder="e.g., Production API, Dev Environment"
            value={formData.displayName}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange("displayName", e.target.value)
            }
            hint="Optional. A friendly name to identify this configuration."
          />

          {/* Active Toggle */}
          <Toggle
            checked={formData.isActive}
            onChange={(checked) => handleChange("isActive", checked)}
            label="Active"
            description="Enable this provider for use in your applications"
          />

          {/* Error Message */}
          {errors.submit && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
              {errors.submit}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <Link href="/providers" className="flex-1">
              <Button type="button" variant="ghost" fullWidth>
                Cancel
              </Button>
            </Link>
            <Button type="submit" loading={loading} fullWidth className="flex-1">
              Create Provider
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
