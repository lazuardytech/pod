import chalk from "chalk";
import ora from "ora";

/**
 * UI Helper Functions
 */

export function success(message: string): void {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

export function error(message: string): void {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

export function info(message: string): void {
  console.log(chalk.blue(`\n${message}\n`));
}

export function warn(message: string): void {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

export function gray(message: string): void {
  console.log(chalk.gray(message));
}

export function spinner(text: string): ReturnType<typeof ora> {
  return ora(text);
}

export function printSection(title: string): void {
  console.log(chalk.blue(`\n${title}\n`));
}

export function printKeyValue(key: string, value: string, isSuccess: boolean = false): void {
  const color = isSuccess ? chalk.green : chalk.gray;
  console.log(color(`  ${key}: ${value}`));
}

export function printList(items: string[], isSuccess: boolean = false): void {
  const symbol = isSuccess ? "✓" : "✗";
  const color = isSuccess ? chalk.green : chalk.gray;
  items.forEach((item) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}
