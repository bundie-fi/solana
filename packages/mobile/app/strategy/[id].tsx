import { View, Text, ScrollView } from "@/tw";
import { useLocalSearchParams } from "expo-router";

export default function StrategyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-white mb-2">Strategy Detail</Text>
        <Text className="text-gray-400">Strategy: {id}</Text>
        {/* TODO: Performance chart */}
        {/* TODO: Portfolio allocation breakdown */}
        {/* TODO: Creator info with .sol name */}
        {/* TODO: "Earn with this strategy" button (gold) */}
        {/* TODO: Link to related prediction markets */}
      </View>
    </ScrollView>
  );
}
