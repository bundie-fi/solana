import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function StrategyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-4 pt-4">
        <Text className="text-2xl font-bold text-white mb-2">Strategy Detail</Text>
        <Text className="text-gray-400">Strategy: {id}</Text>
        {/* TODO: Performance chart */}
        {/* TODO: Portfolio allocation breakdown */}
        {/* TODO: Creator info with .sol name */}
        {/* TODO: "Earn with this strategy" button (gold) */}
        {/* TODO: Link to related prediction markets */}
      </View>
    </SafeAreaView>
  );
}
