import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { supabase, isSupabaseConfigured } from "./supabase";

/** The subset of an expense the receipt parser returns. */
export interface ParsedReceipt {
  merchant: string;
  amount: number;
  category: string;
  /** "YYYY-MM-DD" or "" if the model couldn't read a date. */
  date: string;
  note: string;
}

function mimeFromUri(uri: string): string {
  const ext = (/\.(\w+)(?:\?.*)?$/.exec(uri)?.[1] ?? "jpg").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
  };
  return map[ext] ?? "image/jpeg";
}

/** Convert a local/web image URI into a base64 `data:` URL the API can read. */
async function toDataUrl(uri: string): Promise<string> {
  // Already a usable URL (remote https or an existing data URL).
  if (/^data:image\//i.test(uri) || /^https?:\/\//i.test(uri)) return uri;

  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(blob);
    });
  }

  // Native: read the file as base64 and prefix with its mime type.
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:${mimeFromUri(uri)};base64,${base64}`;
}

/**
 * Extract structured expense fields from a photo of a receipt (or a gas-station
 * sales screen) via the `parse-receipt` Edge Function (GPT-4o vision).
 * Requires the owner to be signed in (the function rejects everyone else).
 */
export async function parseReceiptImage(
  imageUri: string
): Promise<ParsedReceipt> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured");
  }
  if (!imageUri) throw new Error("Add a receipt photo first");

  const image = await toDataUrl(imageUri);

  const { data, error } = await supabase.functions.invoke("parse-receipt", {
    body: { image },
  });

  if (error) {
    let message = error.message ?? "Scan failed";
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        if (body?.error) message = body.error;
        if (body?.detail) {
          let reason = String(body.detail);
          try {
            const d = JSON.parse(body.detail);
            reason = d?.error?.message ?? d?.message ?? reason;
          } catch {
            // detail wasn't JSON — use it as-is
          }
          if (reason) message = `${message}: ${reason}`;
        }
      }
    } catch {
      // ignore — fall back to the generic message
    }
    throw new Error(message);
  }

  const r = (data as any)?.expense;
  if (!r) throw new Error("No expense details came back");

  const amount =
    typeof r.amount === "number"
      ? r.amount
      : parseFloat(String(r.amount ?? "")) || 0;

  return {
    merchant: typeof r.merchant === "string" ? r.merchant : "",
    amount,
    category: typeof r.category === "string" ? r.category : "",
    date: typeof r.date === "string" ? r.date : "",
    note: typeof r.note === "string" ? r.note : "",
  };
}
