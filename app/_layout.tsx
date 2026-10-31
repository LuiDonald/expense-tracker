import { Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DialogHost } from "../src/components/DialogHost";
import { colors } from "../src/lib/theme";

// On web, Expo's default HTML viewport lacks `viewport-fit=cover`, so iOS never
// exposes `env(safe-area-inset-*)` and the bottom tab bar can't pad around the
// home indicator (labels get clipped in Add-to-Home-Screen mode). Force it here
// at module load — before the SafeAreaProvider measures — so the real inset is
// detected.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const vp = document.querySelector('meta[name="viewport"]');
  const content =
    "width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover";
  if (vp) {
    vp.setAttribute("content", content);
  } else {
    const m = document.createElement("meta");
    m.setAttribute("name", "viewport");
    m.setAttribute("content", content);
    document.head.appendChild(m);
  }
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="category/[name]" options={{ title: "Category" }} />
          <Stack.Screen name="expense/[id]" options={{ title: "Expense" }} />
          <Stack.Screen
            name="edit/[id]"
            options={{ title: "Edit Expense", presentation: "modal" }}
          />
        </Stack>
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
