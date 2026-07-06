// Type declarations for open-sse (JS modules without type definitions)
declare module "open-sse/*" {
  const content: any;
  export default content;
}

interface RequestInitCfProperties {
  scrapeShield?: boolean;
  minify?: boolean | { javascript?: boolean; css?: boolean; html?: boolean };
  mirage?: boolean;
  polish?: string;
  [key: string]: unknown;
}

// Shim for window in legacy imports from open-sse
declare var window: any;
