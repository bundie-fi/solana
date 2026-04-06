import { View, Text, ScrollView } from "@/tw";

export default function DiscoverScreen() {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-white mb-2">Discover</Text>
        <Text className="text-gray-400">
          Strategy leaderboard — ranked by live performance
        </Text>
        {/* TODO: Strategy cards with sparklines, APY, TVL */}
        {/* TODO: Timeframe filters (24h, 7d, 30d, All) */}
        {/* TODO: Asset filter (All, USDC, SOL) */}
      </View>
    </ScrollView>
  );
}
