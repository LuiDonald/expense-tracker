import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  currentDialog,
  resolveDialog,
  subscribeDialogs,
  type DialogButton,
} from "../lib/dialogs";
import { colors, radius, spacing } from "../lib/theme";

/**
 * Renders app-wide confirm/alert dialogs driven by src/lib/dialogs.ts.
 * Mounted once at the root so it overlays every screen. Using a real <Modal>
 * (instead of window.confirm / Alert.alert) keeps dialogs working in iOS
 * standalone PWAs and on react-native-web.
 */
export function DialogHost() {
  const [, setTick] = useState(0);

  useEffect(() => subscribeDialogs(() => setTick((t) => t + 1)), []);

  const dialog = currentDialog();
  const visible = dialog !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        // Android back button / Esc → treat as cancel (false).
        if (dialog) resolveDialog(dialog.id, false);
      }}
    >
      <View style={styles.backdrop}>
        {dialog && (
          <View style={styles.card}>
            <Text style={styles.title}>{dialog.title}</Text>
            {dialog.message ? (
              <Text style={styles.message}>{dialog.message}</Text>
            ) : null}
            <View style={styles.actions}>
              {dialog.buttons.map((btn, i) => (
                <DialogAction
                  key={i}
                  button={btn}
                  onPress={() => resolveDialog(dialog.id, btn.value)}
                />
              ))}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function DialogAction({
  button,
  onPress,
}: {
  button: DialogButton;
  onPress: () => void;
}) {
  const textStyle =
    button.style === "destructive"
      ? styles.destructiveText
      : button.style === "cancel"
      ? styles.cancelText
      : styles.defaultText;
  return (
    <Pressable style={styles.btn} onPress={onPress} hitSlop={6}>
      <Text style={textStyle}>{button.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  message: { fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  btn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  defaultText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
  cancelText: { color: colors.textMuted, fontWeight: "600", fontSize: 15 },
  destructiveText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
});
