import { translateText } from "./ui-copy";
import { BridgeError } from "./client";
import { diagnosticText } from "./diagnostic-copy";

// Plain strings retain user content; diagnostics explicitly opt into translation.
export type UiMessage = string | { key: string; diagnostic?: boolean; values?: Record<string, string | number | { key: string; diagnostic?: boolean }>;
  before?: UiMessage; after?: UiMessage };
export function uiMessage(key: string, values?: Exclude<UiMessage, string>["values"],
  parts: { before?: UiMessage; after?: UiMessage } = {}): UiMessage {
  return { key, ...(values === undefined ? {} : { values }), ...parts };
}
export function renderMessage(language: "zh-CN" | "en-US", message: UiMessage): string {
  if (typeof message === "string") return message;
  const values = Object.fromEntries(Object.entries(message.values ?? {}).map(([key, value]) =>
    [key, typeof value === "object" ? renderMessage(language, value) : value]));
  return (message.before ? renderMessage(language, message.before) : "") + (message.diagnostic ? diagnosticText(language, message.key) : translateText(language, message.key, values)) +
    (message.after ? renderMessage(language, message.after) : "");
}
export function diagnosticMessage(value: string | { message: string }): Exclude<UiMessage, string> {
  return { key: typeof value === "string" ? value : value.message, diagnostic: true };
}
export function joinMessages(values: UiMessage[], separator: string): UiMessage {
  return values.reduce<UiMessage>((before, value, index) => uiMessage(index ? separator : "", undefined, { before, after: value }), "");
}
export class UiMessageError extends Error {
  constructor(readonly uiMessage: UiMessage) { super(renderMessage("zh-CN", uiMessage)); }
}
export function errorMessage(error: unknown, fallback: string): UiMessage {
  return error instanceof UiMessageError ? error.uiMessage : error instanceof BridgeError ? diagnosticMessage(error.detail) : error instanceof Error ? diagnosticMessage(error.message) : uiMessage(fallback);
}
