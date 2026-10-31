import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Read from Expo public env vars. Set these in a .env file (see .env.example):
//   EXPO_PUBLIC_SUPABASE_URL=...
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when Supabase credentials are configured. When false, the app runs
 * entirely on in-memory mock data so you can develop without a backend.
 */
export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        // On web, sessions persist in localStorage automatically; on native we
        // use AsyncStorage.
        storage: Platform.OS === "web" ? undefined : AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Needed on web so the magic-link callback (tokens in the URL) is
        // parsed and turned into a session. Not used on native.
        detectSessionInUrl: Platform.OS === "web",
      },
    })
  : null;
