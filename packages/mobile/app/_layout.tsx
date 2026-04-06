import "../src/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { WalletProvider } from "@/providers/wallet-provider";

export default function RootLayout() {
  return (
    <WalletProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0a0a0f" },
          animation: "slide_from_right",
        }}
      />
    </WalletProvider>
  );
}
