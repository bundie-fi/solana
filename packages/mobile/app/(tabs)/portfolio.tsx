import { View, Text, ScrollView } from "@/tw";

export default function PortfolioScreen() {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-white mb-2">Portfolio</Text>
        <Text className="text-gray-400">
          Your earnings, predictions, and creator fees
        </Text>
        {/* TODO: Three yield layer cards (Strategy Yield, Prediction Wins, Creator Fees) */}
        {/* TODO: Your Earnings section (strategy shares) */}
        {/* TODO: Your Predictions section (market positions) */}
      </View>
    </ScrollView>
  );
}
