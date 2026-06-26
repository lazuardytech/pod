// todo(ts): chalk-animation / figlet / gradient-string are CLI-only deps with no
// @types/* packages. The banner module is invoked from the OAuth CLI script
// only; the Next.js runtime never touches it. We type the runtime surface
// we use and let the dynamic import be a permissive `unknown` at the call
// sites. None of these imports produce typed symbols at compile time.
// @ts-expect-error - chalk-animation has no @types package
import chalkAnimation from "chalk-animation";
// @ts-expect-error - figlet has no @types package
import figlet from "figlet";
// @ts-expect-error - gradient-string has no @types package
import gradient from "gradient-string";

/**
 * Display banner
 */
export function showBanner(): void {
  const banner = figlet.textSync("LLM Proxy", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default",
  });

  console.log("\n" + gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  🚀 OAuth CLI for AI Providers\n"));
}

/**
 * Display simple banner (no animation)
 */
export function showSimpleBanner(): void {
  const banner = figlet.textSync("EP CLI", {
    font: "Standard",
    horizontalLayout: "default",
  });
  console.log(gradient.pastel.multiline(banner));
  console.log(gradient.cristal("  OAuth CLI for AI Providers\n"));
}

/**
 * Display success animation
 */
export async function showSuccess(message: string): Promise<void> {
  return new Promise((resolve) => {
    const animation = chalkAnimation.rainbow(`\n✨ ${message}\n`);
    setTimeout(() => {
      animation.stop();
      resolve();
    }, 1000);
  });
}

export type LoadingHandle = { stop: () => void };

/**
 * Display loading animation
 */
export function showLoading(text: string): LoadingHandle {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${text}`);
    i = (i + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write("\r");
    },
  };
}
